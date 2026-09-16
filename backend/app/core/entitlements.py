from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User, UserEntitlement
from app.models.room import Room, RoomActivity


SUPPORTER_ENTITLEMENTS = frozenset({
    "private_rooms", "unlimited_hosting", "create_tournaments", "full_recording",
    "supporter_profile", "supporter_avatars", "larger_multiplayer_sessions", "early_access",
})
PLAN_ENTITLEMENTS = {"FREE": frozenset(), "SUPPORTER": SUPPORTER_ENTITLEMENTS}
FREE_PARTY_PLAYER_LIMIT = 4
FREE_ARCADE_SESSION_LIMIT = 8
FREE_ACTIVE_ROOM_LIMIT = 3
FREE_DAILY_ROOM_LIMIT = 12
EARLY_ACCESS_SYSTEMS = frozenset()
EARLY_ACCESS_FEATURES = frozenset()


def entitlements_for(user: User, db: Session) -> set[str]:
    granted = set(PLAN_ENTITLEMENTS.get(user.plan or "FREE", ()))
    if user.role == "admin" or user.username.lower() == settings.SUPER_ADMIN_USERNAME.lower() or (
        settings.ADMIN_USERNAME and user.username.lower() == settings.ADMIN_USERNAME.lower()
    ):
        granted.update(SUPPORTER_ENTITLEMENTS)
    granted.update(value for (value,) in db.query(UserEntitlement.entitlement).filter(
        UserEntitlement.user_id == user.id,
    ).all())
    return granted


def has_entitlement(user: User, db: Session, entitlement: str) -> bool:
    return entitlement in entitlements_for(user, db)


def require_entitlement(user: User, db: Session, entitlement: str) -> None:
    if not has_entitlement(user, db, entitlement):
        raise HTTPException(status_code=403, detail=f"Supporter entitlement required: {entitlement}")


def require_system_early_access(user: User, db: Session, system: str) -> None:
    if system in EARLY_ACCESS_SYSTEMS:
        require_entitlement(user, db, "early_access")


def require_feature_early_access(user: User, db: Session, feature: str) -> None:
    if feature in EARLY_ACCESS_FEATURES:
        require_entitlement(user, db, "early_access")


def require_multiplayer_hosting_allowance(user: User, db: Session) -> None:
    if has_entitlement(user, db, "unlimited_hosting"):
        return
    recent_rooms = db.query(Room).filter(
        Room.owner_user_id == user.id,
        Room.hosting_mode == "multiplayer",
        Room.hosting_started_at >= datetime.now(timezone.utc) - timedelta(days=1),
    ).count()
    if recent_rooms >= FREE_DAILY_ROOM_LIMIT:
        raise HTTPException(status_code=403, detail="Free daily multiplayer hosting allowance reached")
    active_rooms = db.query(Room).join(RoomActivity, RoomActivity.room_id == Room.id).filter(
        Room.owner_user_id == user.id,
        Room.hosting_mode == "multiplayer",
        RoomActivity.user_id == user.id,
        RoomActivity.last_seen_at >= datetime.now(timezone.utc) - timedelta(minutes=2),
    ).count()
    if active_rooms >= FREE_ACTIVE_ROOM_LIMIT:
        raise HTTPException(status_code=403, detail="Free active multiplayer hosting allowance reached")
