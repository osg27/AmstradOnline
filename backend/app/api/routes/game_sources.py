"""User-supplied public catalogues. No shared ROM catalogue or persistent ROM cache."""
import json
import re
import tempfile
import threading
import time
import zipfile
from collections import defaultdict, deque
from contextlib import contextmanager
from html.parser import HTMLParser
from pathlib import PurePosixPath
from urllib.parse import quote, unquote, urljoin, urlsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.api.routes.rooms import get_current_user_id, require_system_access
from app.core.database import get_db
from app.core.source_fetch import bounded_chunks, open_public, public_url

router = APIRouter(prefix="/library/sources", tags=["game-sources"])
MAX_CATALOGUE_BYTES = 4 * 1024 * 1024
MAX_GAME_BYTES = 128 * 1024 * 1024
MAX_GAMES = 500
# First version: self-contained media, not CD tracks, playlists or giant sets.
SOURCE_EXTENSIONS = {
    "cpc": {"dsk", "zip"},
    "spectrum": {"tap", "tzx", "z80", "sna", "szx", "zip"},
    "c64": {"d64", "t64", "tap", "prg", "crt", "zip"},
    "msx": {"rom", "mx1", "mx2", "dsk", "cas", "zip"},
    "amiga": {"adf", "adz", "dms", "ipf", "zip"},
    "amiga_aga": {"adf", "adz", "dms", "ipf", "zip"},
    "mastersystem": {"sms", "zip"},
    "megadrive": {"bin", "gen", "md", "smd", "zip"},
    "nes": {"nes", "zip"},
    "snes": {"sfc", "smc", "fig", "swc", "zip"},
    "pcengine": {"pce", "sgx", "zip"},
    "arcade": {"zip"},
}


class SourceRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)
    system: str = Field(max_length=32)


_lock = threading.Lock()
_recent = defaultdict(deque)
_active = set()
_slots = threading.BoundedSemaphore(4)


def acquire_operation(user_id, action):
    now = time.monotonic()
    with _lock:
        for key in list(_recent):
            while _recent[key] and _recent[key][0] < now - 60:
                _recent[key].popleft()
            if not _recent[key]:
                del _recent[key]
        history = _recent[(user_id, action)]
        if len(history) >= (12 if action == "scan" else 20) or user_id in _active:
            raise HTTPException(429, "Please wait before starting another source request", headers={"Retry-After": "10"})
        if not _slots.acquire(blocking=False):
            raise HTTPException(503, "Source downloads are busy; please try again shortly", headers={"Retry-After": "10"})
        history.append(now)
        _active.add(user_id)


def release_operation(user_id):
    with _lock:
        if user_id in _active:
            _active.remove(user_id)
            _slots.release()


@contextmanager
def operation(user_id, action):
    acquire_operation(user_id, action)
    try:
        yield
    finally:
        release_operation(user_id)


def check_access(payload, db, user_id):
    if payload.system not in SOURCE_EXTENSIONS:
        raise HTTPException(422, "This system is not supported by source scanning yet")
    require_system_access(db, user_id, payload.system, creating=True)


def filename_for(url):
    name = unquote(urlsplit(url).path.rsplit("/", 1)[-1])
    if not name or len(name) > 255 or any(ord(c) < 32 for c in name) or "/" in name or "\\" in name:
        return None
    return name


def game_entry(url, system, size=None):
    try:
        url = public_url(url)
    except HTTPException:
        return None
    name = filename_for(url)
    if not name or name.rsplit(".", 1)[-1].lower() not in SOURCE_EXTENSIONS[system]:
        return None
    return {"url": url, "file_name": name, "title": name.rsplit(".", 1)[0], "size": size}


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a" and len(self.links) < 10000:
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def scan_source(url, system):
    url = public_url(url)
    direct = game_entry(url, system)
    if direct:
        return {"url": url, "kind": "file", "games": [direct], "truncated": False}
    parts = urlsplit(url)
    if parts.hostname in {"drive.google.com", "docs.google.com"}:
        raise HTTPException(422, "Personal cloud links are not supported. Choose a public download page or connect a local folder.")
    archive = re.fullmatch(r"/(?:details|download|metadata)/([A-Za-z0-9_.-]+)/?", parts.path) if parts.hostname in {"archive.org", "www.archive.org"} else None
    fetch_url = f"https://archive.org/metadata/{archive[1]}" if archive else url
    with open_public(fetch_url) as (response, final_url):
        if not archive and "html" not in response.getheader("Content-Type", "").lower():
            raise HTTPException(422, "Use a public page with game download links, or a direct supported game-file URL")
        content = b"".join(bounded_chunks(response, MAX_CATALOGUE_BYTES))
    candidates = []
    if archive:
        try:
            data = json.loads(content)
            files = data.get("files", [])
            if not isinstance(files, list):
                raise ValueError()
            if data.get("is_dark") or data.get("metadata", {}).get("mediatype") == "collection":
                raise HTTPException(422, "Choose a public Internet Archive item containing files, rather than a collection")
            for item in files:
                name = item.get("name", "")
                if item.get("private") or not isinstance(name, str):
                    continue
                size = item.get("size")
                size = int(size) if str(size).isdigit() else None
                entry = game_entry(f"https://archive.org/download/{archive[1]}/{quote(name, safe='/')}", system, size)
                if entry and (size is None or size <= MAX_GAME_BYTES):
                    candidates.append(entry)
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(422, "Internet Archive did not return a usable item file list") from None
    else:
        parser = LinkParser()
        parser.feed(content.decode("utf-8", errors="replace"))
        for href in parser.links:
            entry = game_entry(urljoin(final_url, href), system)
            if entry:
                candidates.append(entry)
    unique = {entry["url"]: entry for entry in candidates}
    games = list(unique.values())
    return {"url": url, "kind": "archive" if archive else "page", "games": games[:MAX_GAMES], "truncated": len(games) > MAX_GAMES or (not archive and len(parser.links) >= 10000)}


def validate_zip(file):
    started = time.monotonic()
    try:
        with zipfile.ZipFile(file) as archive:
            entries = archive.infolist()
            if len(entries) > 2048 or sum(entry.file_size for entry in entries) > MAX_GAME_BYTES:
                raise HTTPException(413, "This ZIP expands beyond the preview limit; use individual game files")
            total = 0
            for entry in entries:
                path = PurePosixPath(entry.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts or entry.flag_bits & 1:
                    raise HTTPException(422, "Encrypted ZIPs and unsafe archive paths are not supported")
                with archive.open(entry) as member:
                    while True:
                        chunk = member.read(65536)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_GAME_BYTES or time.monotonic() - started > 15:
                            raise HTTPException(413, "This ZIP is too large or complex; use individual game files")
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError):
        raise HTTPException(422, "The downloaded ZIP is invalid or unsupported") from None
    finally:
        file.seek(0)


def download_file(url, system):
    entry = game_entry(url, system)
    if not entry:
        raise HTTPException(422, "The URL must end in a supported game filename")
    file = tempfile.SpooledTemporaryFile(max_size=2 * 1024 * 1024)
    try:
        with open_public(entry["url"]) as (response, _):
            content_type = response.getheader("Content-Type", "").lower()
            if "html" in content_type or "json" in content_type:
                raise HTTPException(422, "The source returned a web page instead of a game file")
            for chunk in bounded_chunks(response, MAX_GAME_BYTES, seconds=120):
                file.write(chunk)
        length = file.tell()
        if not length:
            raise HTTPException(422, "The source returned an empty file")
        file.seek(0)
        prefix = file.read(256).lstrip().lower()
        if prefix.startswith((b"<!doctype html", b"<html")):
            raise HTTPException(422, "The source returned a web page instead of a game file")
        file.seek(0)
        if entry["file_name"].lower().endswith(".zip"):
            validate_zip(file)
        return file, length, entry["file_name"]
    except Exception:
        file.close()
        raise


@router.post("/scan")
def scan(payload: SourceRequest, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    check_access(payload, db, user_id)
    with operation(user_id, "scan"):
        return scan_source(payload.url, payload.system)


@router.post("/download")
def download(payload: SourceRequest, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    check_access(payload, db, user_id)
    acquire_operation(user_id, "download")
    try:
        file, length, name = download_file(payload.url, payload.system)
    except Exception:
        release_operation(user_id)
        raise

    cleanup_lock = threading.Lock()
    cleaned = False

    def cleanup():
        nonlocal cleaned
        with cleanup_lock:
            if cleaned:
                return
            cleaned = True
            file.close()
            release_operation(user_id)

    def stream():
        try:
            while chunk := file.read(65536):
                yield chunk
        finally:
            cleanup()

    return StreamingResponse(stream(), media_type="application/octet-stream", headers={
        "Content-Length": str(length),
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name, safe='')}",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }, background=BackgroundTask(cleanup))
