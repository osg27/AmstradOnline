from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.room import Room
from app.models.user import User

router = APIRouter(prefix="/auth/admin", tags=["admin"])


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
    if not settings.ADMIN_USERNAME:
        raise HTTPException(status_code=403, detail="Admin access is not configured")

    if user.username.lower() != settings.ADMIN_USERNAME.lower():
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
        .limit(25)
        .all()
    )

    return {
        "admin": admin_user.username,
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
            }
            for user in recent_users
        ],
    }
