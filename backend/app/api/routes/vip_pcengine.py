import json
import re
from functools import lru_cache
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.api.routes.auth import get_current_user, is_vip_user
from app.models.user import User


router = APIRouter(prefix="/auth/vip/pcengine", tags=["vip-pcengine"])

ARCHIVE_ITEM = "nointro.tg-16"
ARCHIVE_DOWNLOAD_ROOT = f"https://archive.org/download/{ARCHIVE_ITEM}"
CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "pcengine_vip_catalog.json"
SAFE_GAME_NAME = re.compile(r"^[^/\\\x00-\x1f]+\.7z$", re.IGNORECASE)


def require_vip(user: User = Depends(get_current_user)) -> User:
    if not is_vip_user(user):
        raise HTTPException(status_code=403, detail="VIP access required")
    return user


def archive_request(url: str) -> Request:
    return Request(url, headers={"User-Agent": "OldStyleGaming/1.0"})


@lru_cache(maxsize=1)
def load_catalog() -> dict:
    try:
        games = json.loads(CATALOG_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="PC Engine VIP catalogue is unavailable") from exc
    return {"source": ARCHIVE_ITEM, "games": games}


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


@router.get("/files/{filename}")
def get_archive_file(filename: str, _user: User = Depends(require_vip)):
    if not SAFE_GAME_NAME.fullmatch(filename):
        raise HTTPException(status_code=404, detail="PC Engine game not found")
    catalog_names = {game["file_name"] for game in load_catalog()["games"]}
    if filename not in catalog_names:
        raise HTTPException(status_code=404, detail="PC Engine game not found")

    try:
        response = urlopen(archive_request(f"{ARCHIVE_DOWNLOAD_ROOT}/{quote(filename)}"), timeout=60)
    except HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(status_code=404, detail="PC Engine game not found") from exc
        raise HTTPException(status_code=502, detail="Internet Archive PC Engine download failed") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Internet Archive PC Engine download failed: {exc}") from exc

    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "private, max-age=3600",
    }
    if response.headers.get("Content-Length"):
        headers["Content-Length"] = response.headers["Content-Length"]
    return StreamingResponse(stream_archive_response(response), media_type="application/x-7z-compressed", headers=headers)
