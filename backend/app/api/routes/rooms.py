import random
import string

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.auth import can_use_preview_systems
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.room import Room
from app.models.user import User
from app.schemas.room import RoomCreateRequest, RoomCreateResponse, RoomJoinRequest, RoomResponse

router = APIRouter(prefix="/rooms", tags=["rooms"])


def get_current_user_id(authorization: str | None = Header(default=None)) -> int:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    return int(payload["sub"])



def generate_room_code(length: int = 6) -> str:
    chars = string.ascii_uppercase + string.digits
    return "".join(random.choice(chars) for _ in range(length))


@router.post("/create", response_model=RoomCreateResponse)
def create_room(
    payload: RoomCreateRequest | None = None,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    system = payload.system if payload else "cpc"
    if system in {"amiga", "megadrive", "snes"}:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not can_use_preview_systems(user):
            raise HTTPException(status_code=403, detail="16-bit preview rooms are limited to testers for now")

    room_code = generate_room_code()
    while db.query(Room).filter(Room.room_code == room_code).first():
        room_code = generate_room_code()

    room = Room(
        room_code=room_code,
        owner_user_id=user_id,
        status="waiting",
        system=system,
    )
    db.add(room)
    db.commit()
    db.refresh(room)

    return RoomCreateResponse(room_code=room.room_code, status=room.status, system=room.system)


@router.post("/join", response_model=RoomResponse)
def join_room(
    payload: RoomJoinRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    room = db.query(Room).filter(Room.room_code == payload.room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    return RoomResponse(
        room_code=room.room_code,
        status=room.status,
        owner_user_id=room.owner_user_id,
        system=room.system or "cpc",
    )


@router.get("/{room_code}", response_model=RoomResponse)
def get_room(
    room_code: str,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    room = db.query(Room).filter(Room.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    return RoomResponse(
        room_code=room.room_code,
        status=room.status,
        owner_user_id=room.owner_user_id,
        system=room.system or "cpc",
    )
