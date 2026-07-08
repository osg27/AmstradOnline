from sqlalchemy import desc
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, Query, Header, HTTPException

from app.core.security import decode_access_token
from app.models.score import Score
from app.models.user import User
from app.schemas.score import LeaderboardEntry, ScoreResponse, ScoreSubmit
from app.core.database import get_db


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

router = APIRouter(prefix="/scores", tags=["scores"])


@router.post("/submit", response_model=ScoreResponse)
def submit_score(
    score_data: ScoreSubmit,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit a score for a game."""
    score = Score(
        user_id=current_user.id,
        game=score_data.game,
        system=score_data.system,
        score=score_data.score,
        input_replay=score_data.input_replay,
    )
    db.add(score)
    db.commit()
    db.refresh(score)
    return score


@router.get("/leaderboard/{system}/{game}")
def get_leaderboard(
    system: str,
    game: str,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """Get top scores for a game on a system."""
    scores = (
        db.query(Score, User.username)
        .join(User, Score.user_id == User.id)
        .filter(Score.system == system, Score.game == game)
        .order_by(desc(Score.score), Score.created_at)
        .limit(limit)
        .all()
    )

    return [
        LeaderboardEntry(
            rank=index + 1,
            username=username,
            score=score.score,
            created_at=score.created_at,
        )
        for index, (score, username) in enumerate(scores)
    ]


@router.get("/personal/{system}/{game}")
def get_personal_scores(
    system: str,
    game: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get current user's scores for a game on a system."""
    scores = (
        db.query(Score)
        .filter(
            Score.user_id == current_user.id,
            Score.system == system,
            Score.game == game,
        )
        .order_by(desc(Score.score), Score.created_at)
        .all()
    )
    return scores
