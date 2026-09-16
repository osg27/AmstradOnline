import random
import string
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.routes.auth import can_use_preview_systems, is_admin_user, is_super_admin_user
from app.core.database import get_db
from app.core.security import decode_access_token, hash_password, verify_password
from app.core.entitlements import (
    FREE_ARCADE_SESSION_LIMIT, FREE_PARTY_PLAYER_LIMIT,
    require_entitlement, require_multiplayer_hosting_allowance, require_system_early_access,
)
from app.core.solo_room_abuse import (
    require_open_solo_room, require_solo_activity_allowed, require_solo_creation_allowed,
)
from app.models.room import Room, RoomActivity, RoomAccess
from app.models.friendship import RoomInvite
from app.models.user import User
from app.schemas.room import (
    RoomCreateRequest,
    RoomCreateResponse,
    ArcadeModeUpdateRequest,
    RoomHeartbeatRequest,
    RoomJoinRequest,
    RoomResponse,
    RoomUpdateRequest,
)

router = APIRouter(prefix="/rooms", tags=["rooms"])
TESTING_SYSTEMS = {"amiga_link", "amiga_aga"}
UNAVAILABLE_SYSTEMS = {"saturn", "saturn_beetle"}
ADMIN_ONLY_SYSTEMS = set()
SUPER_ADMIN_ONLY_SYSTEMS = {"saturn", "saturn_beetle"}
XYPHOE_SYSTEMS = set()
PRIVATE_SUPER_ADMIN_SYSTEMS = {"x68000"}
PARTY_SYSTEMS = {"cpc_party", "c64", "arcade"}


def normalize_party_max_players(system: str, requested: int | None) -> int:
    if system not in PARTY_SYSTEMS:
        return 2

    requested_players = requested or 2
    if system == "arcade":
        # Room capacity includes spectators. Cabinet control slots are managed
        # separately by the arcade queue in the client.
        return min(20, max(8, requested_players))
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
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    require_system_early_access(user, db, system)
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
        hosting_mode=room.hosting_mode or "multiplayer",
        party_max_players=room.party_max_players or 2,
        arcade_multiplayer=bool(room.arcade_multiplayer),
        is_private=bool(room.is_private),
        has_password=bool(room.password_hash),
    )


@router.post("/create", response_model=RoomCreateResponse)
def create_room(
    payload: RoomCreateRequest | None = None,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    system = payload.system if payload else "cpc"
    require_system_access(db, user_id, system, creating=True)
    user = db.query(User).filter(User.id == user_id).with_for_update().first()
    hosting_mode = payload.hosting_mode if payload else "multiplayer"
    if hosting_mode == "solo" and payload and (payload.is_private or payload.password or payload.arcade_multiplayer):
        raise HTTPException(status_code=400, detail="Solo rooms cannot be private or multiplayer")
    if hosting_mode == "solo" and system in {"cpc_party", "amiga_link"}:
        raise HTTPException(status_code=400, detail="This system requires a multiplayer room")
    if payload and (payload.is_private or payload.password):
        require_entitlement(user, db, "private_rooms")
    requested_limit = normalize_party_max_players(system, payload.party_max_players if payload else None)
    free_limit = FREE_ARCADE_SESSION_LIMIT if system == "arcade" else FREE_PARTY_PLAYER_LIMIT
    if requested_limit > free_limit:
        require_entitlement(user, db, "larger_multiplayer_sessions")
    if hosting_mode == "multiplayer":
        require_multiplayer_hosting_allowance(user, db)
    else:
        require_solo_creation_allowed(db, user_id, datetime.now(timezone.utc))

    room_code = generate_room_code()
    while db.query(Room).filter(Room.room_code == room_code).first():
        room_code = generate_room_code()

    room = Room(
        room_code=room_code,
        owner_user_id=user_id,
        status="waiting",
        system=system,
        hosting_mode=hosting_mode,
        hosting_started_at=datetime.now(timezone.utc) if hosting_mode == "multiplayer" else None,
        party_max_players=requested_limit,
        arcade_multiplayer=bool(payload.arcade_multiplayer) if payload and system == "arcade" else False,
        is_private=bool(payload.is_private or payload.password) if payload else False,
        password_hash=hash_password(payload.password) if payload and payload.password else None,
    )
    db.add(room)
    db.commit()
    db.refresh(room)

    return RoomCreateResponse(
        room_code=room.room_code,
        status=room.status,
        system=room.system,
        hosting_mode=room.hosting_mode,
        party_max_players=room.party_max_players or 2,
        arcade_multiplayer=bool(room.arcade_multiplayer),
        is_private=bool(room.is_private),
        has_password=bool(room.password_hash),
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
    require_open_solo_room(db, room)
    if room.hosting_mode == "solo" and room.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Solo rooms do not accept guests")
    if room.is_private and room.owner_user_id != user_id:
        already_joined = db.query(RoomAccess).filter(RoomAccess.room_id == room.id, RoomAccess.user_id == user_id).first()
        invited = db.query(RoomInvite).filter(RoomInvite.room_id == room.id, RoomInvite.recipient_id == user_id).first()
        if not already_joined and not invited and not (room.password_hash and payload.password and verify_password(payload.password, room.password_hash)):
            raise HTTPException(status_code=403, detail="Room invitation or password required")
    if not db.query(RoomAccess).filter(RoomAccess.room_id == room.id, RoomAccess.user_id == user_id).first():
        db.add(RoomAccess(room_id=room.id, user_id=user_id))
    if room.system == "arcade" and not room.arcade_multiplayer and room.owner_user_id != user_id:
        raise HTTPException(status_code=409, detail="This MAME cabinet is currently set to single player")

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
    require_open_solo_room(db, room)

    require_system_access(db, user_id, payload.system, creating=True)
    if room.hosting_mode == "solo" and (payload.system in {"cpc_party", "amiga_link"} or payload.arcade_multiplayer):
        raise HTTPException(status_code=400, detail="Open a multiplayer room before enabling multiplayer")
    room.system = payload.system
    next_limit = normalize_party_max_players(payload.system, payload.party_max_players)
    user = db.query(User).filter(User.id == user_id).first()
    free_limit = FREE_ARCADE_SESSION_LIMIT if payload.system == "arcade" else FREE_PARTY_PLAYER_LIMIT
    if next_limit > free_limit:
        require_entitlement(user, db, "larger_multiplayer_sessions")
    room.party_max_players = next_limit
    room.arcade_multiplayer = bool(payload.arcade_multiplayer) if payload.system == "arcade" else False
    room.current_game = None
    db.commit()
    db.refresh(room)

    return serialize_room(room)


@router.patch("/{room_code}/arcade-mode", response_model=RoomResponse)
def update_arcade_mode(
    room_code: str,
    payload: ArcadeModeUpdateRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    room = db.query(Room).filter(Room.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Only the room host can change cabinet mode")
    require_open_solo_room(db, room)
    if room.system != "arcade":
        raise HTTPException(status_code=400, detail="Cabinet mode is only available for MAME rooms")

    if payload.multiplayer and room.hosting_mode == "solo":
        user = db.query(User).filter(User.id == user_id).with_for_update().first()
        if (room.party_max_players or 8) > FREE_ARCADE_SESSION_LIMIT:
            require_entitlement(user, db, "larger_multiplayer_sessions")
        require_multiplayer_hosting_allowance(user, db)
        room.hosting_mode = "multiplayer"
        room.hosting_started_at = datetime.now(timezone.utc)

    room.arcade_multiplayer = payload.multiplayer
    room.party_max_players = normalize_party_max_players("arcade", room.party_max_players)
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
    require_open_solo_room(db, room)
    if room.hosting_mode == "solo" and room.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Solo rooms do not accept guests")
    if room.is_private and room.owner_user_id != user_id and not db.query(RoomAccess).filter(
        RoomAccess.room_id == room.id, RoomAccess.user_id == user_id,
    ).first():
        raise HTTPException(status_code=403, detail="Join this private room first")

    activity = db.query(RoomActivity).filter(
        RoomActivity.room_id == room.id,
        RoomActivity.user_id == user_id,
    ).first()
    now = datetime.now(timezone.utc)
    require_solo_activity_allowed(db, room, user_id, now)
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
    require_open_solo_room(db, room)
    if room.hosting_mode == "solo" and room.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Solo rooms do not accept guests")

    if room.is_private and room.owner_user_id != user_id and not db.query(RoomAccess).filter(
        RoomAccess.room_id == room.id, RoomAccess.user_id == user_id,
    ).first():
        raise HTTPException(status_code=403, detail="Join this private room first")

    return serialize_room(room)
