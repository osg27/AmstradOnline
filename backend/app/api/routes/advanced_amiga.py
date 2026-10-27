"""Private experimental Amiga resources. Never mount this storage as StaticFiles."""
import json
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
import zipfile
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.api.routes.admin import require_admin

ROOT = Path(os.getenv("ADVANCED_AMIGA_STORAGE", str(Path(__file__).resolve().parents[3] / "storage" / "advanced-amiga"))).resolve()
MAX_BYTES = 128 * 1024 * 1024
MAX_FILES = 4096
MAX_STORAGE = 2 * 1024 * 1024 * 1024
def private_headers(response: Response):
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/auth/admin/amiga", tags=["advanced-amiga"], dependencies=[Depends(require_admin), Depends(private_headers)])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Drive(Strict):
    asset: str = Field(pattern=r"^[a-f0-9]{32}$")
    label: str = Field(default="Games", pattern=r"^[A-Za-z0-9 _-]{1,30}$")
    priority: int = Field(default=0, ge=-128, le=127)
    mode: Literal["ro"] = "ro"
    geometry: Literal["rdb", "manual"] = "rdb"
    sectors: int = Field(default=32, ge=1, le=255)
    surfaces: int = Field(default=1, ge=1, le=255)
    reserved: int = Field(default=2, ge=0, le=1024)
    block_size: Literal[512, 1024, 2048, 4096] = 512


class Profile(Strict):
    name: str = Field(min_length=1, max_length=80)
    model: Literal["A500", "A600", "A1200", "A4000", "Custom"] = "A1200"
    cpu: Literal[68000, 68010, 68020, 68030, 68040] = 68020
    chipset: Literal["ocs", "ecs", "aga"] = "aga"
    chip: Literal[0.5, 1, 2] = 2
    slow: Literal[0, 0.5, 1, 1.5] = 0
    fast: Literal[0, 2, 4, 8, 16, 32] = 8
    ntsc: bool = False
    compatible: bool = False
    kickstart: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    floppies: list[str] = Field(default_factory=list, max_length=4)
    drives: list[Drive] = Field(default_factory=list, max_length=8)
    default: bool = False

    @model_validator(mode="after")
    def hardware(self):
        if self.fast > 8 and self.cpu < 68020:
            raise ValueError("Z3 memory requires a 68020 or later CPU")
        if self.cpu >= 68020 and self.slow:
            raise ValueError("Slow RAM is restricted to 68000/68010 configurations")
        if self.chipset == "ocs" and self.chip > 1:
            raise ValueError("OCS supports at most 1 MB Chip RAM")
        return self


def identifier(value):
    if not re.fullmatch(r"[a-f0-9]{32}", value):
        raise HTTPException(400, "Invalid resource identifier")
    return value


def safe_path(root, relative):
    parts = relative.split("/")
    if not relative or len(relative) > 512 or any(not x or x in (".", "..") or any(ord(c) < 32 or c in '\\:\"' for c in x) for x in parts):
        raise HTTPException(400, "Invalid relative filename")
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
            raise HTTPException(400, "Links are not permitted")
    resolved = current.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise HTTPException(400, "Path outside approved storage")
    return resolved


@contextmanager
def database():
    ROOT.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(ROOT / "catalogue.sqlite3", timeout=30) as db:
        db.execute("CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL)")
        db.execute("BEGIN IMMEDIATE")
        yield db


def record(db, key, kind=None):
    row = db.execute("SELECT kind,data FROM resources WHERE id=?", (identifier(key),)).fetchone()
    if not row or (kind and row[0] != kind):
        raise HTTPException(404, "Resource not found")
    return json.loads(row[1])


def put(db, key, kind, data):
    db.execute("INSERT OR REPLACE INTO resources VALUES (?,?,?)", (key, kind, json.dumps(data)))


def tree(root):
    files, total, names = [], 0, set()
    if not root.is_dir():
        raise HTTPException(404, "Folder not found")
    # No links, device nodes, or case aliases may enter the emulator volume.
    pending = [root]
    entries = 0
    while pending:
        directory = pending.pop()
        for item in directory.iterdir():
            entries += 1
            if entries > MAX_FILES:
                raise HTTPException(413, "Folder has too many entries")
            rel = item.relative_to(root).as_posix()
            safe_path(root, rel)
            folded = rel.casefold()
            if folded in names:
                raise HTTPException(400, "Amiga filenames collide ignoring case")
            names.add(folded)
            if item.is_dir():
                pending.append(item)
            elif item.is_file():
                size = item.stat().st_size
                total += size
                if total > MAX_BYTES:
                    raise HTTPException(413, "Folder exceeds 128 MiB")
                files.append({"path": rel, "size": size})
            else:
                raise HTTPException(400, "Only ordinary files and directories are supported")
    return files


@router.get("")
def catalogue():
    with database() as db:
        rows = db.execute("SELECT id,kind,data FROM resources ORDER BY rowid").fetchall()
    return {"profiles": [{"id": k, **json.loads(d)} for k,t,d in rows if t == "profile"],
            "assets": [{"id": k, **json.loads(d)} for k,t,d in rows if t in ("hdf", "rom", "adf", "folder")],
            "capabilities": {"writable": False, "liveFolders": False, "reason": "The bundled core has no verified acknowledged hard-drive flush bridge. Drives are read-only; guest writes are not persisted."}}


@router.put("/profiles/{key}")
def save_profile(key: str, profile: Profile):
    identifier(key)
    with database() as db:
        existing = db.execute("SELECT kind FROM resources WHERE id=?", (key,)).fetchone()
        if existing and existing[0] != "profile":
            raise HTTPException(409, "Identifier belongs to a media resource")
        validate_assets(db, profile)
        if db.execute("SELECT COUNT(*) FROM resources WHERE kind='profile'").fetchone()[0] >= 100 and not db.execute("SELECT 1 FROM resources WHERE id=?", (key,)).fetchone():
            raise HTTPException(413, "Profile limit reached")
        if profile.default:
            for old_key, data in db.execute("SELECT id,data FROM resources WHERE kind='profile'").fetchall():
                old = json.loads(data)
                old["default"] = False
                put(db, old_key, "profile", old)
        put(db, key, "profile", profile.model_dump())
    return {"id": key}


@router.delete("/profiles/{key}")
def delete_profile(key: str):
    with database() as db:
        record(db, key, "profile")
        db.execute("DELETE FROM resources WHERE id=?", (key,))
    return {"deleted": True}


def validate_assets(db, profile):
    if profile.kickstart:
        record(db, profile.kickstart, "rom")
    for key in profile.floppies:
        record(db, key, "adf")
    total = 0
    for drive in profile.drives:
        meta = record(db, drive.asset)
        if meta["type"] not in ("hdf", "folder"):
            raise HTTPException(400, "Invalid drive source")
        total += meta["size"]
    if total > 256 * 1024 * 1024:
        raise HTTPException(413, "Mounted drives exceed the 256 MiB session budget")


@router.post("/assets")
async def upload(request: Request, kind: Literal["hdf", "rom", "adf", "folder"], name: str):
    if not name or len(name) > 120 or any(ord(c) < 32 for c in name):
        raise HTTPException(400, "Invalid display name")
    key = uuid.uuid4().hex
    directory = ROOT / "assets"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / key
    size = 0
    try:
        with target.open("xb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Image exceeds 128 MiB")
                out.write(chunk)
        if not size or (kind == "rom" and size not in (262144, 524288, 1048576)):
            raise HTTPException(400, "Invalid image size")
        with database() as db:
            used = sum(json.loads(x[0]).get("size", 0) for x in db.execute("SELECT data FROM resources WHERE kind != 'profile'"))
            if used + size > MAX_STORAGE:
                raise HTTPException(413, "Private storage quota exceeded")
            meta = {"name": name, "type": kind, "size": size}
            if kind == "folder":
                import zipfile
                import shutil
                folder = ROOT / "folders" / key
                try:
                    with zipfile.ZipFile(target) as archive:
                        infos = archive.infolist()
                        if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_BYTES:
                            raise HTTPException(413, "Folder exceeds import limits")
                        names = {}
                        for info in infos:
                            safe_path(folder, info.orig_filename.rstrip("/"))
                            relative = info.filename.rstrip("/")
                            dest = safe_path(folder, relative)
                            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                                raise HTTPException(400, "Links are not supported")
                            for index in range(1, len(relative.split("/")) + 1):
                                prefix = "/".join(relative.split("/")[:index])
                                if prefix.casefold() in names and names[prefix.casefold()] != prefix:
                                    raise HTTPException(400, "Amiga filenames collide ignoring case")
                                names[prefix.casefold()] = prefix
                            if info.is_dir():
                                dest.mkdir(parents=True, exist_ok=True)
                            else:
                                dest.parent.mkdir(parents=True, exist_ok=True)
                                with archive.open(info) as incoming, dest.open("xb") as outgoing:
                                    shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
                    meta.update(files=tree(folder), source="local-import")
                    meta["size"] = sum(x["size"] for x in meta["files"])
                    if used + meta["size"] > MAX_STORAGE:
                        raise HTTPException(413, "Private storage quota exceeded")
                    target.unlink()
                except BaseException as error:
                    if folder.exists():
                        shutil.rmtree(folder)
                    if isinstance(error, zipfile.BadZipFile):
                        raise HTTPException(400, "Invalid folder import archive") from error
                    raise
            put(db, key, kind, meta)
        return {"id": key, **meta}
    except BaseException:
        target.unlink(missing_ok=True)
        raise


@router.get("/library")
def library():
    root = ROOT / "library"
    root.mkdir(parents=True, exist_ok=True)
    return {"folders": [p.name for p in root.iterdir() if p.is_dir() and not p.is_symlink() and not getattr(p, "is_junction", lambda: False)()][:1000]}


class FolderSelection(Strict):
    folder: str = Field(min_length=1, max_length=120)


@router.post("/library/import")
def import_library(payload: FolderSelection):
    if "/" in payload.folder:
        raise HTTPException(400, "Select a listed library folder")
    source = safe_path(ROOT / "library", payload.folder)
    files = tree(source)
    # Snapshot through checked ordinary files. Source directories are never served publicly.
    import shutil
    key = uuid.uuid4().hex
    target = ROOT / "folders" / key
    try:
        for entry in files:
            dest = safe_path(target, entry["path"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            src = safe_path(source, entry["path"])
            with src.open("rb") as incoming, dest.open("xb") as outgoing:
                remaining = entry["size"]
                while remaining:
                    chunk = incoming.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise HTTPException(409, "Library folder changed during import")
                    outgoing.write(chunk)
                    remaining -= len(chunk)
                if incoming.read(1):
                    raise HTTPException(409, "Library folder changed during import")
        meta = {"name": payload.folder, "type": "folder", "size": sum(x["size"] for x in files), "files": files, "source": "server-import"}
        with database() as db:
            used = sum(json.loads(x[0]).get("size", 0) for x in db.execute("SELECT data FROM resources WHERE kind != 'profile'"))
            if used + meta["size"] > MAX_STORAGE:
                raise HTTPException(413, "Private storage quota exceeded")
            put(db, key, "folder", meta)
        return {"id": key, **meta}
    except BaseException:
        if target.exists():
            shutil.rmtree(target)
        raise


@router.get("/assets/{key}/content")
def content(key: str, path: str | None = None):
    with database() as db:
        meta = record(db, key)
    if meta.get("type") == "folder":
        if path not in {x["path"] for x in meta["files"]}:
            raise HTTPException(404, "File not found")
        target = safe_path(ROOT / "folders" / key, path)
    elif meta.get("type") in ("rom", "adf", "hdf") and path is None:
        target = safe_path(ROOT / "assets", key)
    else:
        raise HTTPException(404, "File not found")
    return FileResponse(target, media_type="application/octet-stream", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


def uae(profile, assets):
    compatibility = profile.model if profile.model != "Custom" else "Generic"
    lines = ["config_description=Advanced Amiga", f"cpu_model={profile.cpu}", "fpu_model=0", f"cpu_compatible={str(profile.compatible).lower()}",
             f"cpu_24bit_addressing={str(profile.cpu < 68020).lower()}", f"chipset={profile.chipset}",
             f"chipset_compatible={compatibility}", f"chipmem_size={int(profile.chip * 2)}", f"bogomem_size={int(profile.slow * 4)}",
             f"fastmem_size={profile.fast if profile.fast <= 8 else 0}", f"z3mem_size={profile.fast if profile.fast > 8 else 0}",
             f"ntsc={str(profile.ntsc).lower()}", "kickstart_rom_file=/advanced/kick.rom", f"nr_floppies={len(profile.floppies)}"]
    for i, key in enumerate(profile.floppies):
        lines.append(f"floppy{i}=/advanced/{key}.adf")
    for i, drive in enumerate(profile.drives):
        meta = assets[drive.asset]
        if meta["type"] == "folder":
            lines.append(f'filesystem2=ro,DH{i}:{drive.label}:"/advanced/{drive.asset}",{drive.priority}')
        else:
            geometry = "0,0,0" if drive.geometry == "rdb" else f"{drive.sectors},{drive.surfaces},{drive.reserved}"
            lines.append(f'hardfile2=ro,DH{i}:"/advanced/{drive.asset}.hdf",{geometry},{drive.block_size},{drive.priority},,uae0')
    return "\n".join(lines) + "\n"


@router.post("/profiles/{key}/launch")
def launch(key: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    with database() as db:
        profile = Profile(**record(db, key, "profile"))
        validate_assets(db, profile)
        if not profile.kickstart:
            raise HTTPException(400, "Select an administrator-supplied Kickstart ROM")
        assets = {d.asset: record(db, d.asset) for d in profile.drives}
        assets[profile.kickstart] = record(db, profile.kickstart, "rom")
        for floppy in profile.floppies:
            assets[floppy] = record(db, floppy, "adf")
    return {"profile": profile.model_dump(), "assets": assets, "uae": uae(profile, assets)}
