from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.database import get_db
from app.models.friendship import Friendship, LobbyMessage, RoomInvite
from app.models.room import Room
from app.models.user import User

router = APIRouter(prefix="/auth/social", tags=["social"])
ONLINE_WINDOW = timedelta(seconds=90)


class FriendRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)


class LobbyChatMessage(BaseModel):
    message: str = Field(min_length=1, max_length=300)


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


def get_friend_ids(db: Session, user_id: int) -> set[int]:
    friendships = db.query(Friendship).filter(
        Friendship.status == "accepted",
        or_(
            Friendship.requester_id == user_id,
            Friendship.addressee_id == user_id,
        ),
    ).all()
    return {
        friendship.addressee_id if friendship.requester_id == user_id else friendship.requester_id
        for friendship in friendships
    }


@router.get("/chat")
def get_lobby_chat(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visible_sender_ids = get_friend_ids(db, current_user.id) | {current_user.id}
    messages = (
        db.query(LobbyMessage, User)
        .join(User, User.id == LobbyMessage.sender_id)
        .filter(
            LobbyMessage.sender_id.in_(visible_sender_ids),
            LobbyMessage.created_at >= datetime.now(timezone.utc) - timedelta(days=7),
        )
        .order_by(LobbyMessage.created_at.desc())
        .limit(100)
        .all()
    )
    return [
        {
            "id": message.id,
            "username": sender.username,
            "message": message.message,
            "created_at": message.created_at,
            "mine": sender.id == current_user.id,
        }
        for message, sender in reversed(messages)
    ]


@router.post("/chat")
def send_lobby_chat_message(
    payload: LobbyChatMessage,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    message_text = payload.message.strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    message = LobbyMessage(sender_id=current_user.id, message=message_text)
    db.add(message)
    db.query(LobbyMessage).filter(
        LobbyMessage.created_at < datetime.now(timezone.utc) - timedelta(days=30)
    ).delete(synchronize_session=False)
    db.commit()
    db.refresh(message)
    return {
        "id": message.id,
        "username": current_user.username,
        "message": message.message,
        "created_at": message.created_at,
        "mine": True,
    }


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
    room_invites = (
        db.query(RoomInvite, User, Room)
        .join(User, User.id == RoomInvite.sender_id)
        .join(Room, Room.id == RoomInvite.room_id)
        .filter(RoomInvite.recipient_id == current_user.id)
        .order_by(RoomInvite.created_at.desc())
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
        "room_invites": [
            {
                "id": invite.id,
                "room_code": room.room_code,
                "system": room.system,
                "sender_username": sender.username,
            }
            for invite, sender, room in room_invites
        ],
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


@router.post("/friends/{user_id}/invite/{room_code}")
def invite_friend_to_room(
    user_id: int,
    room_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    friendship = get_friendship(db, current_user.id, user_id)
    if not friendship or friendship.status != "accepted":
        raise HTTPException(status_code=404, detail="Friend not found")

    room = db.query(Room).filter(Room.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    existing = db.query(RoomInvite).filter(
        RoomInvite.room_id == room.id,
        RoomInvite.recipient_id == user_id,
    ).first()
    if existing:
        existing.sender_id = current_user.id
    else:
        db.add(RoomInvite(room_id=room.id, sender_id=current_user.id, recipient_id=user_id))
    db.commit()
    return {"message": "Room invite sent"}


@router.delete("/invites/{invite_id}", status_code=204)
def dismiss_room_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invite = db.query(RoomInvite).filter(
        RoomInvite.id == invite_id,
        RoomInvite.recipient_id == current_user.id,
    ).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Room invite not found")
    db.delete(invite)
    db.commit()
