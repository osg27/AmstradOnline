from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.routes.auth import is_admin_user, is_super_admin_user
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.feedback import FeedbackComment, FeedbackItem, FeedbackNotification
from app.models.friendship import DirectMessage, Friendship, LobbyMessage, RoomInvite
from app.models.room import Room, RoomActivity
from app.models.user import AccountToken, User

router = APIRouter(prefix="/auth/admin", tags=["admin"])
VALID_ROLES = {"user", "tester", "vip", "xyphoe", "admin"}


class UserRoleRequest(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, value):
        normalized = value.lower().strip()
        if normalized not in VALID_ROLES:
            raise ValueError("Unsupported role")
        return normalized


def get_current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")

    return user


@router.get("/stats")
def get_admin_stats(
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)

    total_users = db.query(func.count(User.id)).scalar() or 0
    total_rooms = db.query(func.count(Room.id)).scalar() or 0
    total_logins = db.query(func.coalesce(func.sum(User.login_count), 0)).scalar() or 0
    active_today = db.query(func.count(User.id)).filter(User.last_login_at >= day_ago).scalar() or 0
    active_week = db.query(func.count(User.id)).filter(User.last_login_at >= week_ago).scalar() or 0

    recent_users = (
        db.query(User)
        .order_by(User.last_login_at.desc(), User.created_at.desc())
        .limit(100)
        .all()
    )
    active_rooms = []
    if is_super_admin_user(admin_user):
        active_cutoff = now - timedelta(seconds=60)
        activity_rows = (
            db.query(RoomActivity, Room, User)
            .join(Room, Room.id == RoomActivity.room_id)
            .join(User, User.id == RoomActivity.user_id)
            .filter(RoomActivity.last_seen_at >= active_cutoff)
            .order_by(Room.created_at.desc(), RoomActivity.last_seen_at.desc())
            .all()
        )
        room_activity = {}
        for activity, room, user in activity_rows:
            entry = room_activity.setdefault(room.id, {
                "room_code": room.room_code,
                "system": room.system or "cpc",
                "game_name": room.current_game,
                "created_at": room.created_at,
                "players": [],
            })
            entry["players"].append({
                "username": user.username,
                "role": "Host" if user.id == room.owner_user_id else "Guest",
                "last_seen_at": activity.last_seen_at,
            })
        active_rooms = list(room_activity.values())

    return {
        "admin": admin_user.username,
        "is_super_admin": is_super_admin_user(admin_user),
        "totals": {
            "users": total_users,
            "rooms": total_rooms,
            "logins": int(total_logins),
            "active_today": active_today,
            "active_week": active_week,
        },
        "recent_users": [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "created_at": user.created_at,
                "last_login_at": user.last_login_at,
                "login_count": user.login_count or 0,
                "role": user.role,
                "is_super_admin": is_super_admin_user(user),
            }
            for user in recent_users
        ],
        "active_rooms": active_rooms,
    }


@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    payload: UserRoleRequest,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if is_super_admin_user(user):
        raise HTTPException(status_code=403, detail="The super admin role is protected")
    if user.id == admin_user.id:
        raise HTTPException(status_code=400, detail="You cannot change your own admin role")

    user.role = payload.role
    db.commit()
    return {"id": user.id, "username": user.username, "role": user.role}


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if is_super_admin_user(user):
        raise HTTPException(status_code=403, detail="The super admin account is protected")
    if user.id == admin_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account")

    feedback_ids = [
        feedback_id
        for (feedback_id,) in db.query(FeedbackItem.id).filter(FeedbackItem.user_id == user.id).all()
    ]
    if feedback_ids:
        db.query(FeedbackComment).filter(FeedbackComment.feedback_id.in_(feedback_ids)).delete(
            synchronize_session=False
        )
        db.query(FeedbackNotification).filter(FeedbackNotification.feedback_id.in_(feedback_ids)).delete(
            synchronize_session=False
        )
        db.query(FeedbackItem).filter(FeedbackItem.id.in_(feedback_ids)).delete(synchronize_session=False)

    db.query(FeedbackComment).filter(FeedbackComment.user_id == user.id).delete(synchronize_session=False)
    db.query(FeedbackNotification).filter(FeedbackNotification.user_id == user.id).delete(synchronize_session=False)
    db.query(Friendship).filter(
        (Friendship.requester_id == user.id) | (Friendship.addressee_id == user.id)
    ).delete(synchronize_session=False)
    owned_room_ids = db.query(Room.id).filter(Room.owner_user_id == user.id)
    db.query(RoomInvite).filter(
        (RoomInvite.sender_id == user.id)
        | (RoomInvite.recipient_id == user.id)
        | RoomInvite.room_id.in_(owned_room_ids)
    ).delete(synchronize_session=False)
    db.query(RoomActivity).filter(
        (RoomActivity.user_id == user.id) | RoomActivity.room_id.in_(owned_room_ids)
    ).delete(synchronize_session=False)
    db.query(LobbyMessage).filter(LobbyMessage.sender_id == user.id).delete(synchronize_session=False)
    db.query(DirectMessage).filter(
        (DirectMessage.sender_id == user.id) | (DirectMessage.recipient_id == user.id)
    ).delete(synchronize_session=False)
    db.query(Room).filter(Room.owner_user_id == user.id).delete(synchronize_session=False)
    db.query(AccountToken).filter(AccountToken.user_id == user.id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
