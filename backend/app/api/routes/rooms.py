import random
import string

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.auth import can_use_preview_systems
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.room import Room
from app.models.friendship import RoomInvite
from app.models.user import User
from app.schemas.room import RoomCreateRequest, RoomCreateResponse, RoomJoinRequest, RoomResponse

router = APIRouter(prefix="/rooms", tags=["rooms"])
TESTING_SYSTEMS = {"amiga_link", "amiga_aga", "snes"}
UNAVAILABLE_SYSTEMS = {"arcade"}


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


def require_system_access(db: Session, user_id: int, system: str) -> None:
    if system in UNAVAILABLE_SYSTEMS:
        raise HTTPException(status_code=403, detail="This system is still under construction")
    if system in TESTING_SYSTEMS:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not can_use_preview_systems(user):
            raise HTTPException(status_code=403, detail="This system is currently being tested")


@router.post("/create", response_model=RoomCreateResponse)
def create_room(
    payload: RoomCreateRequest | None = None,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    system = payload.system if payload else "cpc"
    require_system_access(db, user_id, system)

    room_code = generate_room_code()
    while db.query(Room).filter(Room.room_code == room_code).first():
        room_code = generate_room_code()

    room = Room(
        room_code=room_code,
        owner_user_id=user_id,
        status="waiting",
        system=system,
        party_max_players=payload.party_max_players if system == "cpc_party" and payload else 2,
    )
    db.add(room)
    db.commit()
    db.refresh(room)

    return RoomCreateResponse(
        room_code=room.room_code,
        status=room.status,
        system=room.system,
        party_max_players=room.party_max_players or 2,
    )


@router.post("/join", response_model=RoomResponse)
def join_room(
    payload: RoomJoinRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    room = db.query(Room).filter(Room.room_code == payload.room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    require_system_access(db, user_id, room.system or "cpc")

    db.query(RoomInvite).filter(
        RoomInvite.room_id == room.id,
        RoomInvite.recipient_id == user_id,
    ).delete(synchronize_session=False)
    db.commit()

    return RoomResponse(
        room_code=room.room_code,
        status=room.status,
        owner_user_id=room.owner_user_id,
        system=room.system or "cpc",
        party_max_players=room.party_max_players or 2,
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
    require_system_access(db, user_id, room.system or "cpc")

    return RoomResponse(
        room_code=room.room_code,
        status=room.status,
        owner_user_id=room.owner_user_id,
        system=room.system or "cpc",
        party_max_players=room.party_max_players or 2,
    )
