import random
import string
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.routes.auth import can_use_preview_systems, is_admin_user, is_super_admin_user
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.room import Room, RoomActivity
from app.models.friendship import RoomInvite
from app.models.user import User
from app.schemas.room import (
    RoomCreateRequest,
    RoomCreateResponse,
    RoomHeartbeatRequest,
    RoomJoinRequest,
    RoomResponse,
    RoomUpdateRequest,
)

router = APIRouter(prefix="/rooms", tags=["rooms"])
TESTING_SYSTEMS = {"amiga_link", "amiga_aga", "nes", "snes", "c64", "pcengine", "playstation", "atarist", "atari8", "mastersystem", "arcade"}
UNAVAILABLE_SYSTEMS = set()
ADMIN_ONLY_SYSTEMS = set()
SUPER_ADMIN_ONLY_SYSTEMS = set()
XYPHOE_SYSTEMS = set()
PRIVATE_SUPER_ADMIN_SYSTEMS = set()
PARTY_SYSTEMS = {"cpc_party", "c64", "arcade"}


def normalize_party_max_players(system: str, requested: int | None) -> int:
    if system not in PARTY_SYSTEMS:
        return 2

    requested_players = requested or 2
    if system == "arcade":
        return min(4, max(3, requested_players))
    return min(8, max(2, requested_players))


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


def require_system_access(db: Session, user_id: int, system: str, *, creating: bool = False) -> None:
    if system in UNAVAILABLE_SYSTEMS:
        raise HTTPException(status_code=403, detail="This system is still under construction")
    if system in PRIVATE_SUPER_ADMIN_SYSTEMS:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not is_super_admin_user(user):
            raise HTTPException(status_code=403, detail="This system is only available to the super admin")
        return
    if creating and system in SUPER_ADMIN_ONLY_SYSTEMS:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not is_super_admin_user(user):
            raise HTTPException(status_code=403, detail="This system is only available to the super admin")
        return
    if system in ADMIN_ONLY_SYSTEMS:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not is_admin_user(user):
            raise HTTPException(status_code=403, detail="This system is only available to admins")
        return
    if system in TESTING_SYSTEMS:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not can_use_preview_systems(user):
            raise HTTPException(status_code=403, detail="This system is currently being tested")


def serialize_room(room: Room) -> RoomResponse:
    return RoomResponse(
        room_code=room.room_code,
        status=room.status,
        owner_user_id=room.owner_user_id,
        system=room.system or "cpc",
        party_max_players=room.party_max_players or 2,
    )


@router.post("/create", response_model=RoomCreateResponse)
def create_room(
    payload: RoomCreateRequest | None = None,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    system = payload.system if payload else "cpc"
    require_system_access(db, user_id, system, creating=True)

    room_code = generate_room_code()
    while db.query(Room).filter(Room.room_code == room_code).first():
        room_code = generate_room_code()

    room = Room(
        room_code=room_code,
        owner_user_id=user_id,
        status="waiting",
        system=system,
        party_max_players=normalize_party_max_players(system, payload.party_max_players if payload else None),
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

    return serialize_room(room)

@router.patch("/{room_code}", response_model=RoomResponse)
def update_room(
    room_code: str,
    payload: RoomUpdateRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    room = db.query(Room).filter(Room.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Only the room host can change the system")

    require_system_access(db, user_id, payload.system, creating=True)
    room.system = payload.system
    room.party_max_players = normalize_party_max_players(payload.system, payload.party_max_players)
    room.current_game = None
    db.commit()
    db.refresh(room)

    return serialize_room(room)


@router.post("/{room_code}/heartbeat", status_code=204)
def room_heartbeat(
    room_code: str,
    payload: RoomHeartbeatRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    room = db.query(Room).filter(Room.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    require_system_access(db, user_id, room.system or "cpc")

    activity = db.query(RoomActivity).filter(
        RoomActivity.room_id == room.id,
        RoomActivity.user_id == user_id,
    ).first()
    now = datetime.now(timezone.utc)
    try:
        if activity:
            activity.last_seen_at = now
        else:
            db.add(RoomActivity(room_id=room.id, user_id=user_id, last_seen_at=now))

        if room.owner_user_id == user_id:
            room.current_game = payload.game_name.strip()[:240] if payload.game_name else None

        db.commit()
    except IntegrityError:
        db.rollback()
        activity = db.query(RoomActivity).filter(
            RoomActivity.room_id == room.id,
            RoomActivity.user_id == user_id,
        ).first()
        if activity:
            activity.last_seen_at = now
        if room.owner_user_id == user_id:
            room.current_game = payload.game_name.strip()[:240] if payload.game_name else None
        db.commit()


@router.delete("/{room_code}/heartbeat", status_code=204)
def leave_room_activity(
    room_code: str,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    room = db.query(Room).filter(Room.room_code == room_code.upper()).first()
    if not room:
        return

    db.query(RoomActivity).filter(
        RoomActivity.room_id == room.id,
        RoomActivity.user_id == user_id,
    ).delete(synchronize_session=False)
    if room.owner_user_id == user_id:
        room.current_game = None
    db.commit()


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

    return serialize_room(room)
