"""Technical safeguards for solo rooms; unrelated to plans or entitlements."""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.room import Room, RoomActivity


SOLO_BURST_LIMIT = 20
SOLO_BURST_WINDOW = timedelta(minutes=1)
SOLO_HOURLY_LIMIT = 240
SOLO_HOURLY_WINDOW = timedelta(hours=1)
SOLO_ACTIVE_LIMIT = 12
SOLO_ACTIVE_WINDOW = timedelta(minutes=2)
SOLO_IDLE_EXPIRY = timedelta(hours=12)


def _rate_limited(detail: str, retry_after: int) -> None:
    raise HTTPException(status_code=429, detail=detail, headers={"Retry-After": str(retry_after)})


def expire_idle_solo_rooms(db: Session, user_id: int, now: datetime) -> None:
    """Retain history for profiles while closing rooms abandoned for 12 hours."""
    cutoff = now - SOLO_IDLE_EXPIRY
    recently_active_room_ids = select(RoomActivity.room_id).where(
        RoomActivity.user_id == user_id,
        RoomActivity.last_seen_at >= cutoff,
    )
    db.execute(update(Room).where(
        Room.owner_user_id == user_id,
        Room.hosting_mode == "solo",
        Room.status == "waiting",
        Room.created_at < cutoff,
        ~Room.id.in_(recently_active_room_ids),
    ).values(status="expired"))


def require_open_solo_room(db: Session, room: Room, now: datetime | None = None) -> None:
    if room.hosting_mode != "solo":
        return
    if room.status == "expired":
        raise HTTPException(status_code=410, detail="This solo room has expired; launch the game again")
    now = now or datetime.now(timezone.utc)
    cutoff = now - SOLO_IDLE_EXPIRY
    created_at = room.created_at
    if created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    if created_at and created_at < cutoff:
        recent = db.query(RoomActivity.id).filter(
            RoomActivity.room_id == room.id,
            RoomActivity.user_id == room.owner_user_id,
            RoomActivity.last_seen_at >= cutoff,
        ).first()
        if not recent:
            room.status = "expired"
            db.commit()
            raise HTTPException(status_code=410, detail="This solo room has expired; launch the game again")


def active_solo_room_count(db: Session, user_id: int, now: datetime) -> int:
    return db.query(Room.id).join(RoomActivity, RoomActivity.room_id == Room.id).filter(
        Room.owner_user_id == user_id,
        Room.hosting_mode == "solo",
        Room.status == "waiting",
        RoomActivity.user_id == user_id,
        RoomActivity.last_seen_at >= now - SOLO_ACTIVE_WINDOW,
    ).count()


def require_solo_creation_allowed(db: Session, user_id: int, now: datetime) -> None:
    expire_idle_solo_rooms(db, user_id, now)
    for limit, window in (
        (SOLO_BURST_LIMIT, SOLO_BURST_WINDOW),
        (SOLO_HOURLY_LIMIT, SOLO_HOURLY_WINDOW),
    ):
        recent = db.query(Room.id).filter(
            Room.owner_user_id == user_id,
            Room.hosting_mode == "solo",
            Room.created_at >= now - window,
        ).count()
        if recent >= limit:
            _rate_limited("Solo rooms are being created too quickly; try again shortly", int(window.total_seconds()))
    if active_solo_room_count(db, user_id, now) >= SOLO_ACTIVE_LIMIT:
        _rate_limited("Too many solo rooms are active at once; close an unused game", 120)


def require_solo_activity_allowed(db: Session, room: Room, user_id: int, now: datetime) -> None:
    if room.hosting_mode != "solo":
        return
    existing = db.query(RoomActivity.id).filter(
        RoomActivity.room_id == room.id,
        RoomActivity.user_id == user_id,
        RoomActivity.last_seen_at >= now - SOLO_ACTIVE_WINDOW,
    ).first()
    if not existing and active_solo_room_count(db, user_id, now) >= SOLO_ACTIVE_LIMIT:
        _rate_limited("Too many solo rooms are active at once; close an unused game", 120)
