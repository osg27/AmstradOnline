import hashlib
import mimetypes
import os
import re
import shutil
from functools import lru_cache
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


router = APIRouter(prefix="/library/media", tags=["library-media"])

DEFAULT_MEDIA_ROOT = Path(__file__).resolve().parents[4] / "library_media"
MEDIA_ROOT = Path(os.getenv("LIBRARY_MEDIA_DIR", str(DEFAULT_MEDIA_ROOT))).resolve()
MAX_BYTES = int(os.getenv("LIBRARY_MEDIA_MAX_BYTES", str(8 * 1024 * 1024)))

CONTENT_TYPE_EXTENSIONS = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
URL_EXTENSIONS = {".gif", ".jpg", ".jpeg", ".png", ".webp"}


class BoxArtCacheRequest(BaseModel):
    url: str
    system: str | None = None
    title: str | None = None
    rom_name: str | None = None


class BoxArtLookupRequest(BaseModel):
    system: str
    rom_names: list[str]
    titles: dict[str, str] = Field(default_factory=dict)


def _slug(value: str | None) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "unknown").lower()).strip("-")
    return slug or "unknown"


def _response_url(path: Path) -> str:
    # Artwork is served with long-lived cache headers in production. Include a
    # value derived from the current file so replacing an indexed image changes
    # its URL without disabling caching for unchanged media.
    stat = path.stat()
    version = f"{stat.st_mtime_ns:x}-{stat.st_size:x}"
    return f"/library/media/files/{path.relative_to(MEDIA_ROOT).as_posix()}?v={version}"


def _extension_for_response(content_type: str | None, url_path: str) -> str:
    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type in CONTENT_TYPE_EXTENSIONS:
        return CONTENT_TYPE_EXTENSIONS[normalized_type]

    suffix = Path(url_path).suffix.lower()
    if suffix in URL_EXTENSIONS:
        return ".jpg" if suffix == ".jpeg" else suffix

    raise HTTPException(status_code=400, detail="URL did not return a supported image type")


def _rom_key(value: str | None) -> str:
    return _slug(re.sub(r"\.(?:zip|7z)$", "", value or "", flags=re.IGNORECASE))


@lru_cache(maxsize=16)
def _title_artwork_files(title_dir: str, directory_mtime_ns: int) -> tuple[tuple[str, Path], ...]:
    del directory_mtime_ns  # Its value invalidates the cache when files are added or removed.
    root = Path(title_dir)
    return tuple(
        (candidate.stem, candidate)
        for candidate in root.iterdir()
        if candidate.is_file() and candidate.suffix.lower() in URL_EXTENSIONS
    )


def _unique_longer_title_match(title_dir: Path, title_key: str) -> Path | None:
    # WHDLoad/library titles are often shorter than packaging artwork titles
    # (for example "Allo Allo" versus "Allo Allo! Cartoon Fun!"). Only use
    # this fallback when there is one unambiguous longer title.
    if len(title_key) < 5 or "-" not in title_key or not title_dir.is_dir():
        return None
    candidates = [
        path
        for stem, path in _title_artwork_files(str(title_dir), title_dir.stat().st_mtime_ns)
        if stem.startswith(f"{title_key}-")
    ]
    return candidates[0] if len(candidates) == 1 else None


def _indexed_box_art(system: str, rom_name: str, title: str | None = None) -> Path | None:
    index_dir = MEDIA_ROOT / "boxart" / _slug(system) / "by-rom"
    key = _rom_key(rom_name)
    for extension in CONTENT_TYPE_EXTENSIONS.values():
        candidate = index_dir / f"{key}{extension}"
        if candidate.is_file():
            return candidate
    if title:
        title_dir = MEDIA_ROOT / "boxart" / _slug(system) / "by-title"
        title_key = _slug(title)
        for extension in CONTENT_TYPE_EXTENSIONS.values():
            candidate = title_dir / f"{title_key}{extension}"
            if candidate.is_file():
                return candidate
        longer_title = _unique_longer_title_match(title_dir, title_key)
        if longer_title:
            return longer_title
    return None


def _index_box_art(target: Path, system: str, rom_name: str | None) -> None:
    if not rom_name:
        return
    index_dir = MEDIA_ROOT / "boxart" / _slug(system) / "by-rom"
    index_dir.mkdir(parents=True, exist_ok=True)
    indexed_target = index_dir / f"{_rom_key(rom_name)}{target.suffix}"
    if indexed_target.is_file() and indexed_target.stat().st_size == target.stat().st_size:
        return
    temp = indexed_target.with_suffix(f"{indexed_target.suffix}.tmp")
    shutil.copyfile(target, temp)
    temp.replace(indexed_target)


@router.post("/boxart")
def cache_box_art(payload: BoxArtCacheRequest):
    parsed = urlparse(payload.url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Only HTTP image URLs can be cached")

    system = _slug(payload.system)
    key = hashlib.sha256(f"{system}\0{payload.url}".encode("utf-8")).hexdigest()
    target_dir = MEDIA_ROOT / "boxart" / system
    target_dir.mkdir(parents=True, exist_ok=True)

    request = Request(payload.url, headers={"User-Agent": "OldStyleGaming/1.0"})
    try:
        with urlopen(request, timeout=15) as response:
            extension = _extension_for_response(response.headers.get("content-type"), parsed.path)
            target = target_dir / f"{key}{extension}"
            if target.is_file():
                _index_box_art(target, system, payload.rom_name)
                return {
                    "url": _response_url(target),
                    "cached": True,
                    "bytes": target.stat().st_size,
                    "content_type": mimetypes.guess_type(target.name)[0],
                }

            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise HTTPException(status_code=413, detail="Image is too large to cache")

            temp = target.with_suffix(f"{target.suffix}.tmp")
            temp.write_bytes(data)
            temp.replace(target)
            _index_box_art(target, system, payload.rom_name)
    except HTTPException:
        raise
    except HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Image download failed: HTTP {exc.code}") from exc
    except URLError as exc:
        raise HTTPException(status_code=400, detail=f"Image download failed: {exc.reason}") from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=408, detail="Image download timed out") from exc

    return {
        "url": _response_url(target),
        "cached": False,
        "bytes": target.stat().st_size,
        "content_type": mimetypes.guess_type(target.name)[0],
    }


@router.post("/boxart/lookup")
def lookup_box_art(payload: BoxArtLookupRequest):
    if len(payload.rom_names) > 6000:
        raise HTTPException(status_code=400, detail="Too many ROM names")

    matches = {}
    for rom_name in dict.fromkeys(payload.rom_names):
        target = _indexed_box_art(payload.system, rom_name, payload.titles.get(rom_name))
        if target:
            matches[rom_name] = _response_url(target)
    return {"matches": matches}


@router.get("/files/{path:path}")
def get_cached_media(path: str):
    target = (MEDIA_ROOT / path).resolve()
    try:
        target.relative_to(MEDIA_ROOT)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Media file not found") from exc

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Media file not found")

    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type)
