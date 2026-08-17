import re
import json
from pathlib import Path
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
SAFE_ARCHIVE_NAME = re.compile(r"^[a-zA-Z0-9_.+ -]+\.zip$")
CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "mame_vip_catalog.json"


def require_vip(user: User = Depends(get_current_user)) -> User:
    if not is_vip_user(user):
        raise HTTPException(status_code=403, detail="VIP access required")
    return user


def archive_request(url: str) -> Request:
    return Request(url, headers={"User-Agent": "OldStyleGaming/1.0"})


def load_archive_catalog() -> dict:
    try:
        result = json.loads(CATALOG_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="The bundled MAME catalogue is unavailable") from exc
    result["catalog_source"] = "bundled"
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
    if directory == "roms" and filename not in catalog["roms"]:
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
