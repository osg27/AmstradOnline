from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.database import get_db
from app.models.friendship import Friendship
from app.models.user import User

router = APIRouter(prefix="/auth/social", tags=["social"])
ONLINE_WINDOW = timedelta(seconds=90)


class FriendRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)


def is_online(user: User, now: datetime) -> bool:
    if not user.last_seen_at:
        return False
    last_seen = user.last_seen_at
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    return last_seen >= now - ONLINE_WINDOW


def user_summary(user: User, now: datetime) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "is_online": is_online(user, now),
    }


def get_friendship(db: Session, first_user_id: int, second_user_id: int) -> Friendship | None:
    return db.query(Friendship).filter(
        or_(
            (Friendship.requester_id == first_user_id) & (Friendship.addressee_id == second_user_id),
            (Friendship.requester_id == second_user_id) & (Friendship.addressee_id == first_user_id),
        )
    ).first()


@router.post("/heartbeat", status_code=204)
def heartbeat(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.last_seen_at = datetime.now(timezone.utc)
    db.commit()


@router.get("")
def get_social_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    current_user.last_seen_at = now

    friendships = db.query(Friendship).filter(
        or_(
            Friendship.requester_id == current_user.id,
            Friendship.addressee_id == current_user.id,
        )
    ).all()
    user_ids = {
        friendship.addressee_id if friendship.requester_id == current_user.id else friendship.requester_id
        for friendship in friendships
    }
    users_by_id = {
        user.id: user
        for user in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    friends = []
    incoming_requests = []
    outgoing_requests = []
    friend_ids = set()
    pending_ids = set()

    for friendship in friendships:
        other_id = (
            friendship.addressee_id
            if friendship.requester_id == current_user.id
            else friendship.requester_id
        )
        other_user = users_by_id.get(other_id)
        if not other_user:
            continue
        entry = {
            **user_summary(other_user, now),
            "friendship_id": friendship.id,
        }
        if friendship.status == "accepted":
            friend_ids.add(other_id)
            friends.append(entry)
        elif friendship.addressee_id == current_user.id:
            pending_ids.add(other_id)
            incoming_requests.append(entry)
        else:
            pending_ids.add(other_id)
            outgoing_requests.append(entry)

    online_users = (
        db.query(User)
        .filter(
            User.id != current_user.id,
            User.email_verified.is_(True),
            User.last_seen_at >= now - ONLINE_WINDOW,
        )
        .order_by(User.username)
        .all()
    )

    db.commit()
    return {
        "online_users": [
            {
                **user_summary(user, now),
                "is_friend": user.id in friend_ids,
                "request_pending": user.id in pending_ids,
            }
            for user in online_users
        ],
        "friends": sorted(friends, key=lambda item: (not item["is_online"], item["username"].lower())),
        "incoming_requests": sorted(incoming_requests, key=lambda item: item["username"].lower()),
        "outgoing_requests": sorted(outgoing_requests, key=lambda item: item["username"].lower()),
    }


@router.post("/requests")
def send_friend_request(
    payload: FriendRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    username = payload.username.strip()
    addressee = db.query(User).filter(func.lower(User.username) == username.lower()).first()
    if not addressee:
        raise HTTPException(status_code=404, detail="Player not found")
    if addressee.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot add yourself")

    existing = get_friendship(db, current_user.id, addressee.id)
    if existing:
        if existing.status == "accepted":
            raise HTTPException(status_code=400, detail="You are already friends")
        raise HTTPException(status_code=400, detail="A friend request is already waiting")

    friendship = Friendship(requester_id=current_user.id, addressee_id=addressee.id)
    db.add(friendship)
    db.commit()
    return {"message": f"Friend request sent to {addressee.username}"}


@router.post("/requests/{friendship_id}/accept")
def accept_friend_request(
    friendship_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    friendship = db.query(Friendship).filter(
        Friendship.id == friendship_id,
        Friendship.addressee_id == current_user.id,
        Friendship.status == "pending",
    ).first()
    if not friendship:
        raise HTTPException(status_code=404, detail="Friend request not found")

    friendship.status = "accepted"
    friendship.accepted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Friend request accepted"}


@router.delete("/requests/{friendship_id}", status_code=204)
def decline_or_cancel_friend_request(
    friendship_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    friendship = db.query(Friendship).filter(
        Friendship.id == friendship_id,
        Friendship.status == "pending",
        or_(
            Friendship.requester_id == current_user.id,
            Friendship.addressee_id == current_user.id,
        ),
    ).first()
    if not friendship:
        raise HTTPException(status_code=404, detail="Friend request not found")
    db.delete(friendship)
    db.commit()


@router.delete("/friends/{user_id}", status_code=204)
def remove_friend(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    friendship = get_friendship(db, current_user.id, user_id)
    if not friendship or friendship.status != "accepted":
        raise HTTPException(status_code=404, detail="Friend not found")
    db.delete(friendship)
    db.commit()
