from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.database import get_db
from app.models.room import Room, RoomActivity
from app.models.tournament import Tournament, TournamentEntry, TournamentScore
from app.models.user import User


router = APIRouter(prefix="/auth/profile", tags=["profile"])
AVATARS = {
    "arcade-green", "space-purple", "racer-red", "wizard-blue",
    "robot-gold", "ghost-mint", "ninja-pink", "knight-silver",
}


class AvatarUpdate(BaseModel):
    avatar_id: str


def aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def medal_results(db: Session, user_id: int, now: datetime) -> list[dict]:
    scores = (
        db.query(TournamentScore, Tournament)
        .join(Tournament, Tournament.id == TournamentScore.tournament_id)
        .filter(TournamentScore.user_id == user_id, Tournament.ends_at <= now)
        .order_by(desc(Tournament.ends_at))
        .all()
    )
    results = []
    for score, tournament in scores:
        rank = db.query(TournamentScore).filter(
            TournamentScore.tournament_id == tournament.id,
            (TournamentScore.score > score.score) | (
                (TournamentScore.score == score.score)
                & (TournamentScore.achieved_at < score.achieved_at)
            ),
        ).count() + 1
        if rank <= 3:
            results.append({
                "code": tournament.code,
                "name": tournament.name,
                "game": tournament.display_name,
                "rank": rank,
                "score": score.score,
                "ended_at": tournament.ends_at,
            })
    return results


def serialize_profile(user: User, db: Session) -> dict:
    now = datetime.now(timezone.utc)
    activities = (
        db.query(RoomActivity, Room)
        .join(Room, Room.id == RoomActivity.room_id)
        .filter(RoomActivity.user_id == user.id)
        .all()
    )
    seconds_played = 0
    systems = set()
    for activity, room in activities:
        started = aware(room.created_at)
        ended = min(aware(activity.last_seen_at), started + timedelta(hours=12), now)
        seconds_played += max(0, int((ended - started).total_seconds()))
        if room.system:
            systems.add(room.system)

    medals = medal_results(db, user.id, now)
    medal_counts = {
        "gold": sum(item["rank"] == 1 for item in medals),
        "silver": sum(item["rank"] == 2 for item in medals),
        "bronze": sum(item["rank"] == 3 for item in medals),
    }
    tournaments_entered = db.query(TournamentEntry).filter(TournamentEntry.user_id == user.id).count()
    games_played = len(activities)
    hours_played = round(seconds_played / 3600, 1)
    achievements = [
        {"id": "first-credit", "name": "Insert Coin", "description": "Play your first game room.", "icon": "coin", "unlocked": games_played >= 1},
        {"id": "regular", "name": "Arcade Regular", "description": "Play in 10 game rooms.", "icon": "joystick", "unlocked": games_played >= 10},
        {"id": "system-hopper", "name": "System Hopper", "description": "Play across five different systems.", "icon": "systems", "unlocked": len(systems) >= 5},
        {"id": "contender", "name": "Contender", "description": "Enter a tournament.", "icon": "flag", "unlocked": tournaments_entered >= 1},
        {"id": "podium", "name": "On the Podium", "description": "Finish in a tournament top three.", "icon": "bronze", "unlocked": bool(medals)},
        {"id": "champion", "name": "Tournament Champion", "description": "Win a tournament.", "icon": "gold", "unlocked": medal_counts["gold"] >= 1},
        {"id": "time-served", "name": "One More Go", "description": "Spend 25 hours playing.", "icon": "clock", "unlocked": hours_played >= 25},
    ]
    return {
        "username": user.username,
        "avatar_id": user.avatar_id or "arcade-green",
        "member_since": user.created_at,
        "role": user.role,
        "stats": {
            "games_played": games_played,
            "hours_played": hours_played,
            "systems_played": len(systems),
            "tournaments_entered": tournaments_entered,
            "achievements_unlocked": sum(item["unlocked"] for item in achievements),
        },
        "medals": medal_counts,
        "podiums": medals[:12],
        "achievements": achievements,
        "available_avatars": sorted(AVATARS),
    }


@router.get("")
def get_profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return serialize_profile(user, db)


@router.patch("/avatar")
def update_avatar(
    payload: AvatarUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.avatar_id not in AVATARS:
        raise HTTPException(status_code=400, detail="Unknown avatar")
    user.avatar_id = payload.avatar_id
    db.commit()
    return {"avatar_id": user.avatar_id}
