import hashlib
import mimetypes
import os
import re
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel


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


def _slug(value: str | None) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "unknown").lower()).strip("-")
    return slug or "unknown"


def _response_url(path: Path) -> str:
    return f"/library/media/files/{path.relative_to(MEDIA_ROOT).as_posix()}"


def _extension_for_response(content_type: str | None, url_path: str) -> str:
    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type in CONTENT_TYPE_EXTENSIONS:
        return CONTENT_TYPE_EXTENSIONS[normalized_type]

    suffix = Path(url_path).suffix.lower()
    if suffix in URL_EXTENSIONS:
        return ".jpg" if suffix == ".jpeg" else suffix

    raise HTTPException(status_code=400, detail="URL did not return a supported image type")


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
