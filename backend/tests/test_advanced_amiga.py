"""No production database or copyrighted media required."""
import io
import uuid
import zipfile
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import advanced_amiga as amiga
from app.api.routes.admin import get_current_user
from fastapi import HTTPException


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(amiga, "ROOT", tmp_path)
    app = FastAPI()
    app.include_router(amiga.router)
    def identity():
        return SimpleNamespace(id=1, username="test-admin", role="admin")
    app.dependency_overrides[get_current_user] = identity
    with TestClient(app) as session:
        session.identity = identity
        session.app_instance = app
        yield session


def key():
    return uuid.uuid4().hex


def test_authorization_covers_all_routes(client):
    app = client.app_instance
    probes = [("GET", ""), ("PUT", f"/profiles/{key()}"), ("DELETE", f"/profiles/{key()}"),
              ("POST", f"/profiles/{key()}/launch"), ("POST", "/assets?kind=hdf&name=test"),
              ("GET", "/library"), ("POST", "/library/import"), ("GET", f"/assets/{key()}/content")]
    for expected in (401, 403):
        def identity():
            if expected == 401:
                raise HTTPException(401, "Missing token")
            return SimpleNamespace(id=2, username="ordinary", role="user")
        app.dependency_overrides[get_current_user] = identity
        for method, path in probes:
            response = client.request(method, "/auth/admin/amiga" + path, json={})
            assert response.status_code == expected, (method, path, response.text)


def test_profiles_validate_hardware_and_private_asset_ids(client):
    base = "/auth/admin/amiga"
    profile = {"name": "Workbench", "cpu": 68000, "fast": 32}
    assert client.put(f"{base}/profiles/{key()}", json=profile).status_code == 422
    assert client.put(f"{base}/profiles/{key()}", json={"name": "Bad", "kickstart": key()}).status_code == 404
    first, second = key(), key()
    assert client.put(f"{base}/profiles/{first}", json={"name": "First", "default": True}).status_code == 200
    assert client.put(f"{base}/profiles/{second}", json={"name": "Second", "default": True}).status_code == 200
    profiles = client.get(base).json()["profiles"]
    assert sum(p["default"] for p in profiles) == 1
    assert client.post(f"{base}/profiles/{second}/launch").status_code == 400


def test_folder_import_and_real_uae_mount(client):
    base = "/auth/admin/amiga"
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as out:
        out.writestr("Moonstone/Game/Data", b"private-content")
        out.writestr("Moonstone.info", b"icon")
    folder = client.post(f"{base}/assets?kind=folder&name=Games", content=archive.getvalue()).json()
    rom = client.post(f"{base}/assets?kind=rom&name=Kickstart", content=b"x" * 524288).json()
    profile = {"name": "Workbench", "kickstart": rom["id"], "drives": [{"asset": folder["id"]}]}
    profile_id = key()
    assert client.put(f"{base}/profiles/{profile_id}", json=profile).status_code == 200
    launch = client.post(f"{base}/profiles/{profile_id}/launch").json()
    assert 'filesystem2=ro,DH0:Games:' in launch["uae"]
    assert 'chipmem_size=4' in launch["uae"]
    assert 'bogomem_size=0' in launch["uae"]
    assert 'chipset_compatible=A1200' in launch["uae"]
    assert 'fastmem_size=8' in launch["uae"]
    assert client.get(f'{base}/assets/{folder["id"]}/content?path=Moonstone/Game/Data').content == b"private-content"
    assert client.get(f'{base}/assets/{folder["id"]}/content?path=../../secret').status_code == 404


@pytest.mark.parametrize("filename", ["../escape", "/absolute", "C:/secret", "test\\secret", 'bad"name'])
def test_archive_traversal_rejected(client, filename):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as out:
        info = zipfile.ZipInfo("placeholder")
        info.filename = filename
        out.writestr(info, b"secret")
    response = client.post("/auth/admin/amiga/assets?kind=folder&name=Games", content=archive.getvalue())
    assert response.status_code == 400


def test_case_collisions_rejected(client):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as out:
        out.writestr("Game", b"a")
        out.writestr("game", b"b")
    assert client.post("/auth/admin/amiga/assets?kind=folder&name=Games", content=archive.getvalue()).status_code == 400


def test_server_folder_selection_and_restrictions(client):
    directory = amiga.ROOT / "library" / "Games" / "Moonstone"
    directory.mkdir(parents=True)
    (directory / "Data").write_bytes(b"installed-game")
    base = "/auth/admin/amiga"
    assert client.get(base + "/library").json() == {"folders": ["Games"]}
    assert client.post(base + "/library/import", json={"folder": "../outside"}).status_code == 400
    result = client.post(base + "/library/import", json={"folder": "Games"})
    assert result.status_code == 200
    folder = result.json()
    assert folder["files"] == [{"path": "Moonstone/Data", "size": 14}]


def test_hdf_geometry_and_write_rejection():
    drive = {"asset": key(), "geometry": "manual", "surfaces": 4, "priority": 10}
    profile = amiga.Profile(name="test", drives=[drive])
    config = amiga.uae(profile, {drive["asset"]: {"type": "hdf"}})
    assert ',32,4,2,512,10,,uae0' in config
    with pytest.raises(ValueError):
        amiga.Drive(**{**drive, "mode": "rw"})


def test_hdf_upload_limit_is_separate_from_folder_and_floppy_limit(client, monkeypatch):
    # Exercise both boundaries without allocating a 1 GiB test image.
    monkeypatch.setattr(amiga, "MAX_BYTES", 4)
    monkeypatch.setattr(amiga, "MAX_HDF_BYTES", 8)
    base = "/auth/admin/amiga/assets"
    accepted = client.post(base + "?kind=hdf&name=System_P96.hdf", content=b"123456")
    assert accepted.status_code == 200
    assert accepted.json()["size"] == 6
    assert client.post(base + "?kind=hdf&name=too-large.hdf", content=b"123456789").status_code == 413
    assert client.post(base + "?kind=adf&name=too-large.adf", content=b"123456").status_code == 413


def test_500_mib_hdf_can_be_saved_and_launched(client):
    asset_id = key()
    rom_id = key()
    with amiga.database() as db:
        amiga.put(db, asset_id, "hdf", {"name": "System_P96.hdf", "type": "hdf", "size": 512000 * 1024})
        amiga.put(db, rom_id, "rom", {"name": "test ROM metadata", "type": "rom", "size": 524288})
    profile_id = key()
    response = client.put(f"/auth/admin/amiga/profiles/{profile_id}", json={"name": "Workbench", "kickstart": rom_id, "drives": [{"asset": asset_id}]})
    assert response.status_code == 200
    launch = client.post(f"/auth/admin/amiga/profiles/{profile_id}/launch")
    assert launch.status_code == 200
    assert launch.json()["assets"][asset_id]["size"] == 512000 * 1024


def test_local_hdf_launch_requires_no_server_image(client):
    base = '/auth/admin/amiga'
    rom = client.post(base + '/assets?kind=rom&name=test', content=b'x' * 524288).json()
    local_id, profile_id = key(), key()
    drive = {"asset": local_id, "source": "local", "local_name": "System_P96.hdf", "local_size": 512000 * 1024}
    profile = {"name": "Local Workbench", "kickstart": rom['id'], "drives": [drive]}
    assert client.put(f'{base}/profiles/{profile_id}', json=profile).status_code == 200
    response = client.post(f'{base}/profiles/{profile_id}/launch')
    assert response.status_code == 200
    assert response.json()['assets'][local_id]['source'] == 'local'
    assert f'/advanced/{local_id}.hdf' in response.json()['uae']
    assert not (amiga.ROOT / 'assets' / local_id).exists()
    assert client.get(f'{base}/assets/{local_id}/content').status_code == 404
    missing_size = {**drive, 'local_size': None}
    assert client.put(f'{base}/profiles/{key()}', json={**profile, 'drives': [missing_size]}).status_code == 422
