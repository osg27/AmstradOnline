import json
from functools import lru_cache
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api.routes.auth import get_current_user, is_vip_user
from app.models.user import User


router = APIRouter(prefix="/auth/vip/nes", tags=["vip-nes"])
ARCHIVE_ITEM = "NESMegaPack201808"
ARCHIVE_FILE = "ROMS.zip"
ARCHIVE_DOWNLOAD_ROOT = f"https://archive.org/download/{ARCHIVE_ITEM}/{ARCHIVE_FILE}"
CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "nes_vip_catalog.json"


def require_vip(user: User = Depends(get_current_user)) -> User:
    if not is_vip_user(user):
        raise HTTPException(status_code=403, detail="VIP access required")
    return user


@lru_cache(maxsize=1)
def load_catalog() -> dict:
    try:
        games = json.loads(CATALOG_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="NES VIP catalogue is unavailable") from exc
    return {"source": ARCHIVE_ITEM, "archive": ARCHIVE_FILE, "games": games}


@router.get("/catalog")
def get_catalog(_user: User = Depends(require_vip)):
    return load_catalog()


def stream_archive_response(response):
    try:
        while True:
            chunk = response.read(256 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        response.close()


@router.get("/file")
def get_archive_file(
    member: str = Query(..., min_length=5, max_length=512),
    _user: User = Depends(require_vip),
):
    allowed = {game["member_path"] for game in load_catalog()["games"]}
    if member not in allowed:
        raise HTTPException(status_code=404, detail="NES game not found")
    encoded_member = "/".join(quote(part, safe="") for part in member.split("/"))
    try:
        response = urlopen(Request(
            f"{ARCHIVE_DOWNLOAD_ROOT}/{encoded_member}",
            headers={"User-Agent": "OldStyleGaming/1.0"},
        ), timeout=60)
    except HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(status_code=404, detail="NES game not found") from exc
        raise HTTPException(status_code=502, detail="Internet Archive NES download failed") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Internet Archive NES download failed: {exc}") from exc
    filename = member.rsplit("/", 1)[-1]
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "private, max-age=3600",
    }
    if response.headers.get("Content-Length"):
        headers["Content-Length"] = response.headers["Content-Length"]
    return StreamingResponse(stream_archive_response(response), media_type="application/octet-stream", headers=headers)
