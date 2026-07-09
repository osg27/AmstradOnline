from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.routes.auth import is_admin_user
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.mame_leaderboard import MameHighScore, MameLeaderboardGame
from app.models.user import User
from app.schemas.mame_leaderboard import (
    MameLeaderboardEntry,
    MameLeaderboardGameResponse,
    MameScoreExtractionRequest,
    MameScoreExtractionResponse,
)
from app.services.mame_high_scores import (
    cleanup_uncalibrated_mame_scores,
    extract_mame_scores,
    is_uncalibrated_mame_game,
    normalise_rom_name,
    seed_default_mame_games,
)

router = APIRouter(prefix="/mame", tags=["mame"])


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


@router.get("/leaderboards", response_model=list[MameLeaderboardGameResponse])
def list_mame_leaderboards(db: Session = Depends(get_db)):
    seed_default_mame_games(db)
    return (
        db.query(MameLeaderboardGame)
        .filter(MameLeaderboardGame.leaderboard_supported == True)  # noqa: E712
        .order_by(MameLeaderboardGame.display_name)
        .all()
    )


@router.get("/leaderboards/{rom_name}", response_model=list[MameLeaderboardEntry])
def get_mame_leaderboard(
    rom_name: str,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    seed_default_mame_games(db)
    rom_name = normalise_rom_name(rom_name)
    cleanup_uncalibrated_mame_scores(db)
    if is_uncalibrated_mame_game(rom_name):
        return []

    game = db.query(MameLeaderboardGame).filter(MameLeaderboardGame.rom_name == rom_name).first()
    if not game or not game.enabled or not game.leaderboard_supported:
        return []

    rows = (
        db.query(MameHighScore, User.username)
        .join(User, MameHighScore.user_id == User.id)
        .filter(MameHighScore.rom_name == rom_name)
        .order_by(desc(MameHighScore.score), MameHighScore.created_at)
        .limit(limit)
        .all()
    )
    return [
        MameLeaderboardEntry(
            rank=index + 1,
            username=username,
            initials=score.initials,
            score=score.score,
            rank_in_game=score.rank_in_game,
            created_at=score.created_at,
        )
        for index, (score, username) in enumerate(rows)
    ]


@router.post("/sessions/{session_id}/extract-scores", response_model=MameScoreExtractionResponse)
def extract_mame_session_scores(
    session_id: str,
    payload: MameScoreExtractionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user_id = payload.user_id or current_user.id
    if target_user_id != current_user.id and not is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Only admins can extract scores for another user")

    result = extract_mame_scores(
        db,
        session_id=session_id[:128],
        rom_name=payload.rom_name,
        user_id=target_user_id,
        save_files=[item.model_dump() for item in payload.save_files],
    )
    return MameScoreExtractionResponse(
        session_id=session_id[:128],
        rom_name=normalise_rom_name(payload.rom_name),
        **result,
    )
