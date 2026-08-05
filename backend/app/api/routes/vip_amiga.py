import re
import time
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import xml.etree.ElementTree as ET
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse

from app.api.routes.auth import get_current_user, is_vip_user
from app.models.user import User


router = APIRouter(prefix="/auth/vip/amiga", tags=["vip-amiga"])

ARCHIVE_ITEM = "Amiga_WHD_Games"
ARCHIVE_DOWNLOAD_ROOT = f"https://archive.org/download/{ARCHIVE_ITEM}"
ARCHIVE_FILES_XML = f"{ARCHIVE_DOWNLOAD_ROOT}/{ARCHIVE_ITEM}_files.xml"
SAFE_WHDLOAD_NAME = re.compile(r"^[^/\\\x00-\x1f]+\.(?:lha|zip)$", re.IGNORECASE)
CATALOG_TTL_SECONDS = 6 * 60 * 60
_catalog_cache: tuple[float, dict] | None = None
FIRMWARE_ARCHIVE_ROOT = "https://archive.org/download/commodore-amiga-firmware"
KICKSTART_ARCHIVES = {
    "a500": "Kickstart v1.3 r34.005 (1987-12)(Commodore)(A500-A1000-A2000-CDTV)[!].zip",
    "a1200": "Kickstart v3.1 r40.068 (1993-12)(Commodore)(A1200)[!].zip",
}
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
X68000_FIRMWARE_FILES = {
    "keropi/iplrom.dat": REPOSITORY_ROOT / "keropi" / "iplrom.dat",
    "keropi/cgrom.dat": REPOSITORY_ROOT / "keropi" / "cgrom.dat",
    "keropi/iplrom30.dat": REPOSITORY_ROOT / "keropi" / "iplrom30.dat",
    "keropi/iplromco.dat": REPOSITORY_ROOT / "keropi" / "iplromco.dat",
    "keropi/iplromxv.dat": REPOSITORY_ROOT / "keropi" / "iplromxv.dat",
}


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
        raise HTTPException(status_code=502, detail=f"Internet Archive Amiga catalogue is unavailable: {exc}") from exc

    games = []
    for file_element in root.findall("file"):
        file_name = str(file_element.attrib.get("name") or "")
        if not SAFE_WHDLOAD_NAME.fullmatch(file_name):
            continue
        size_element = file_element.find("size")
        try:
            size = int(size_element.text or 0) if size_element is not None else 0
        except ValueError:
            size = 0
        games.append({"file_name": file_name, "bytes": size})

    games.sort(key=lambda game: game["file_name"].casefold())
    result = {"source": ARCHIVE_ITEM, "games": games}
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


@router.get("/kickstarts/{model}")
def get_kickstart_archive(model: str, _user: User = Depends(require_vip)):
    filename = KICKSTART_ARCHIVES.get(model.lower())
    if not filename:
        raise HTTPException(status_code=404, detail="Kickstart ROM not found")
    try:
        response = urlopen(archive_request(f"{FIRMWARE_ARCHIVE_ROOT}/{quote(filename)}"), timeout=60)
    except HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(status_code=404, detail="Kickstart ROM not found") from exc
        raise HTTPException(status_code=502, detail="Internet Archive Kickstart download failed") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Internet Archive Kickstart download failed: {exc}") from exc

    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "private, max-age=3600",
    }
    if response.headers.get("Content-Length"):
        headers["Content-Length"] = response.headers["Content-Length"]
    return StreamingResponse(stream_archive_response(response), media_type="application/zip", headers=headers)


@router.get("/x68000-firmware")
def get_x68000_firmware(_user: User = Depends(require_vip)):
    missing = [path.name for path in X68000_FIRMWARE_FILES.values() if not path.is_file()]
    if missing:
        raise HTTPException(status_code=503, detail=f"X68000 firmware is unavailable: {', '.join(missing)}")

    archive = BytesIO()
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as bundle:
        for archive_name, source_path in X68000_FIRMWARE_FILES.items():
            bundle.writestr(archive_name, source_path.read_bytes())

    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="x68000-firmware.zip"',
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.get("/files/{filename}")
def get_archive_file(filename: str, _user: User = Depends(require_vip)):
    if not SAFE_WHDLOAD_NAME.fullmatch(filename):
        raise HTTPException(status_code=404, detail="Amiga WHDLoad file not found")

    catalog_names = {game["file_name"] for game in load_archive_catalog()["games"]}
    if filename not in catalog_names:
        raise HTTPException(status_code=404, detail="Amiga WHDLoad file not found")

    url = f"{ARCHIVE_DOWNLOAD_ROOT}/{quote(filename)}"
    try:
        response = urlopen(archive_request(url), timeout=60)
    except HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(status_code=404, detail="Amiga WHDLoad file not found") from exc
        raise HTTPException(status_code=502, detail="Internet Archive Amiga download failed") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Internet Archive Amiga download failed: {exc}") from exc

    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "private, max-age=3600",
    }
    content_length = response.headers.get("Content-Length")
    if content_length:
        headers["Content-Length"] = content_length
    media_type = "application/zip" if filename.lower().endswith(".zip") else "application/octet-stream"
    return StreamingResponse(stream_archive_response(response), media_type=media_type, headers=headers)
