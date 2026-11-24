import hashlib
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes import link_games as routes
from app.core.database import Base, get_db


@pytest.fixture
def catalogue(tmp_path, monkeypatch):
    engine = create_engine('sqlite:///:memory:', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine)
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_db] = lambda: db
    actor = SimpleNamespace(id=1, username='link-uploader', role='admin')
    app.dependency_overrides[routes.get_current_user] = lambda: actor
    monkeypatch.setattr(routes, 'DISK_ROOT', tmp_path)
    with TestClient(app) as client:
        yield client, actor, tmp_path
    db.close()
    engine.dispose()


def upload(client, data=None, filename='Stunt Car Racer.adf', **fields):
    return client.post('/auth/link-games', data={'title': 'Stunt Car Racer', **fields},
                       files={'file': (filename, bytes(routes.ADF_BYTES) if data is None else data)})


def test_admin_upload_is_shared_and_download_is_exact(catalogue):
    client, actor, root = catalogue
    response = upload(client, notes='Choose Computer Link in both games.')
    assert response.status_code == 201
    game = response.json()
    assert game['sha256'] == hashlib.sha256(bytes(routes.ADF_BYTES)).hexdigest()
    assert game['notes'] == 'Choose Computer Link in both games.'
    assert set(game) == {'id', 'title', 'file_name', 'size', 'sha256', 'notes'}
    assert (root / f"{game['sha256']}.adf").is_file()
    actor.role = 'user'
    assert client.get('/auth/link-games').json()['games'] == [game]
    assert client.get(f"/auth/link-games/{game['id']}").json() == game
    disk = client.get(f"/auth/link-games/{game['id']}/disk")
    assert disk.status_code == 200
    assert disk.content == bytes(routes.ADF_BYTES)
    assert disk.headers['cache-control'] == 'private, no-store'


def test_non_admin_cannot_upload_or_remove(catalogue):
    client, actor, root = catalogue
    game = upload(client).json()
    actor.role = 'user'
    assert upload(client).status_code == 403
    assert client.delete(f"/auth/link-games/{game['id']}").status_code == 403
    assert len(list(root.glob('*.adf'))) == 1


@pytest.mark.parametrize('filename,size', [
    ('kick.rom', 262144), ('kick.adf', 524288), ('game.lha', 901120),
    ('game.zip', 901120), ('game.adf', 0), ('game.adf', 901121),
])
def test_invalid_upload_does_not_publish_or_write(catalogue, filename, size):
    client, _, root = catalogue
    assert upload(client, data=bytes(size), filename=filename).status_code == 422
    assert client.get('/auth/link-games').json()['games'] == []
    assert list(root.iterdir()) == []


def test_removal_hides_game_without_deleting_another_entrys_disk(catalogue):
    client, _, root = catalogue
    first = upload(client).json()
    second = upload(client, title='Another entry').json()
    assert client.delete(f"/auth/link-games/{first['id']}").status_code == 200
    assert client.get(f"/auth/link-games/{first['id']}/disk").status_code == 404
    assert client.get('/auth/link-games').json()['games'] == [second]
    assert client.get(f"/auth/link-games/{second['id']}/disk").status_code == 200
    assert len(list(root.glob('*.adf'))) == 1


def test_supplied_paths_never_control_storage(catalogue):
    client, _, root = catalogue
    game = upload(client, filename='C:\\private\\disk.adf').json()
    assert game['file_name'] == 'disk.adf'
    assert list(root.iterdir()) == [root / f"{game['sha256']}.adf"]
    assert client.get('/auth/link-games/not-a-valid-id/disk').status_code == 404


def test_sign_in_is_required(catalogue):
    client, _, _ = catalogue
    client.app.dependency_overrides.pop(routes.get_current_user)
    assert client.get('/auth/link-games').status_code == 401
    assert upload(client).status_code == 401


def test_blank_title_and_missing_disk_are_explained(catalogue):
    client, _, root = catalogue
    assert upload(client, title=' ').status_code == 422
    game = upload(client).json()
    (root / f"{game['sha256']}.adf").unlink()
    response = client.get(f"/auth/link-games/{game['id']}/disk")
    assert response.status_code == 404
    assert 'missing from server storage' in response.json()['detail']
