import re
import time
import xml.etree.ElementTree as ET
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.api.routes.auth import get_current_user, is_vip_user
from app.models.user import User

router = APIRouter(prefix="/auth/vip/mame", tags=["vip-mame"])

ARCHIVE_ITEM = "mame-2003-plus-reference-set"
ARCHIVE_DOWNLOAD_ROOT = f"https://archive.org/download/{ARCHIVE_ITEM}"
ARCHIVE_FILES_XML = f"{ARCHIVE_DOWNLOAD_ROOT}/{ARCHIVE_ITEM}_files.xml"
SAFE_ARCHIVE_NAME = re.compile(r"^[a-zA-Z0-9_.+ -]+\.zip$")
CATALOG_TTL_SECONDS = 6 * 60 * 60
_catalog_cache: tuple[float, dict] | None = None


def require_vip(user: User = Depends(get_current_user)) -> User:
    if not is_vip_user(user):
        raise HTTPException(status_code=403, detail="VIP access required")
    return user


def archive_request(url: str) -> Request:
    return Request(url, headers={"User-Agent": "OldStyleGaming/1.0"})


def load_archive_catalog() -> dict:
    global _catalog_cache
    now = time.monotonic()
    if _catalog_cache and now - _catalog_cache[0] < CATALOG_TTL_SECONDS:
        return _catalog_cache[1]

    try:
        with urlopen(archive_request(ARCHIVE_FILES_XML), timeout=30) as response:
            root = ET.fromstring(response.read())
    except (HTTPError, URLError, TimeoutError, ET.ParseError) as exc:
        raise HTTPException(status_code=502, detail=f"Internet Archive catalogue is unavailable: {exc}") from exc

    result = {"roms": [], "samples": []}
    for file_element in root.findall("file"):
        path = str(file_element.attrib.get("name") or "")
        directory, separator, filename = path.partition("/")
        if not separator or directory not in result or not SAFE_ARCHIVE_NAME.fullmatch(filename):
            continue
        result[directory].append(filename)

    result["roms"].sort()
    result["samples"].sort()
    _catalog_cache = (now, result)
    return result


@router.get("/catalog")
def get_catalog(_user: User = Depends(require_vip)):
    return load_archive_catalog()


def stream_archive_response(response):
    try:
        while True:
            chunk = response.read(256 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        response.close()


@router.get("/files/{directory}/{filename}")
def get_archive_file(directory: str, filename: str, _user: User = Depends(require_vip)):
    if directory not in {"roms", "samples"} or not SAFE_ARCHIVE_NAME.fullmatch(filename):
        raise HTTPException(status_code=404, detail="Archive file not found")

    catalog = load_archive_catalog()
    if filename not in catalog[directory]:
        raise HTTPException(status_code=404, detail="Archive file not found")

    url = f"{ARCHIVE_DOWNLOAD_ROOT}/{directory}/{quote(filename)}"
    try:
        response = urlopen(archive_request(url), timeout=60)
    except HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(status_code=404, detail="Archive file not found") from exc
        raise HTTPException(status_code=502, detail="Internet Archive download failed") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Internet Archive download failed: {exc}") from exc

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "private, max-age=3600",
    }
    content_length = response.headers.get("Content-Length")
    if content_length:
        headers["Content-Length"] = content_length
    return StreamingResponse(stream_archive_response(response), media_type="application/zip", headers=headers)
