import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.api.routes.auth import get_current_user, is_vip_user
from app.models.user import User


router = APIRouter(prefix="/auth/vip/c64", tags=["vip-c64"])

DEFAULT_ONELOAD_ROOT = Path(__file__).resolve().parents[4] / "OneLoad64-Games-Collection-v5"
ONELOAD_ROOT = Path(os.getenv("VIP_C64_ONELOAD_DIR", str(DEFAULT_ONELOAD_ROOT))).resolve()
SAFE_CARTRIDGE_NAME = re.compile(r"^[^/\\\x00-\x1f]+\.crt$", re.IGNORECASE)


def require_vip(user: User = Depends(get_current_user)) -> User:
    if not is_vip_user(user):
        raise HTTPException(status_code=403, detail="VIP access required")
    return user


def oneload_cartridges() -> list[Path]:
    if not ONELOAD_ROOT.is_dir():
        raise HTTPException(status_code=503, detail="C64 OneLoad library is unavailable")
    return sorted(
        (
            path
            for path in ONELOAD_ROOT.iterdir()
            if path.is_file() and path.suffix.lower() == ".crt"
        ),
        key=lambda path: path.name.casefold(),
    )


@router.get("/catalog")
def get_catalog(_user: User = Depends(require_vip)):
    return {
        "source": "OneLoad64 Games Collection v5",
        "games": [
            {"file_name": path.name, "bytes": path.stat().st_size}
            for path in oneload_cartridges()
        ],
    }


@router.get("/files/{filename}")
def get_cartridge(filename: str, _user: User = Depends(require_vip)):
    if not SAFE_CARTRIDGE_NAME.fullmatch(filename):
        raise HTTPException(status_code=404, detail="C64 cartridge not found")

    target = (ONELOAD_ROOT / filename).resolve()
    try:
        target.relative_to(ONELOAD_ROOT)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="C64 cartridge not found") from exc
    if not target.is_file() or target.parent != ONELOAD_ROOT or target.suffix.lower() != ".crt":
        raise HTTPException(status_code=404, detail="C64 cartridge not found")

    return FileResponse(
        target,
        media_type="application/octet-stream",
        filename=target.name,
        headers={"Cache-Control": "private, max-age=3600"},
    )
