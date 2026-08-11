import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.database import get_db
from app.models.amiga_leaderboard import AmigaHighScore
from app.models.user import User
from app.schemas.amiga_leaderboard import AmigaLeaderboardEntry, AmigaScoreExtractionRequest
from app.services.amiga_high_scores import (
    BATTLE_SQUADRON_GAME_KEY,
    BATTLE_SQUADRON_PARSER,
    find_new_battle_squadron_scores,
    parse_battle_squadron_lodsco,
)


router = APIRouter(prefix="/scores/amiga", tags=["amiga-scores"])


def _decode(value: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="Invalid Amiga score file") from exc


@router.get("/leaderboards/{game_key}", response_model=list[AmigaLeaderboardEntry])
def get_amiga_leaderboard(game_key: str, db: Session = Depends(get_db)):
    if game_key != BATTLE_SQUADRON_GAME_KEY:
        raise HTTPException(status_code=404, detail="Amiga leaderboard not found")
    rows = (
        db.query(AmigaHighScore, User.username)
        .join(User, AmigaHighScore.user_id == User.id)
        .filter(AmigaHighScore.game_key == game_key)
        .order_by(desc(AmigaHighScore.score), AmigaHighScore.created_at)
        .limit(10)
        .all()
    )
    return [
        AmigaLeaderboardEntry(rank=index, username=username, score=row.score, initials=row.initials)
        for index, (row, username) in enumerate(rows, start=1)
    ]


@router.post("/extract-score")
def extract_amiga_score(
    payload: AmigaScoreExtractionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.game_key != BATTLE_SQUADRON_GAME_KEY:
        raise HTTPException(status_code=404, detail="Amiga leaderboard not found")
    if payload.source_path.rsplit("/", 1)[-1].upper() != "LODSCO":
        raise HTTPException(status_code=400, detail="Battle Squadron LODSCO file required")

    current_data = _decode(payload.data)
    baseline_data = _decode(payload.baseline_data)
    current_rows = parse_battle_squadron_lodsco(current_data)
    baseline_rows = parse_battle_squadron_lodsco(baseline_data)
    candidates = find_new_battle_squadron_scores(current_data, baseline_data)
    if not candidates:
        return {
            "status": "no_scores",
            "message": "No new saved Battle Squadron score found",
            "rows_inserted": 0,
            "current_bytes": len(current_data),
            "baseline_bytes": len(baseline_data),
            "current_rows": len(current_rows),
            "baseline_rows": len(baseline_rows),
        }

    candidate = candidates[0]
    existing = db.query(AmigaHighScore).filter(
        AmigaHighScore.user_id == user.id,
        AmigaHighScore.game_key == payload.game_key,
    ).first()
    if existing and existing.score >= candidate["score"]:
        return {"status": "ok", "message": "Score checked; personal best unchanged", "rows_inserted": 0}

    if existing:
        existing.score = candidate["score"]
        existing.initials = candidate["initials"]
        existing.session_id = payload.session_id
        existing.source_path = payload.source_path
        existing.parser = BATTLE_SQUADRON_PARSER
    else:
        db.add(AmigaHighScore(
            user_id=user.id,
            game_key=payload.game_key,
            score=candidate["score"],
            initials=candidate["initials"],
            session_id=payload.session_id,
            source_path=payload.source_path,
            parser=BATTLE_SQUADRON_PARSER,
        ))
    db.commit()
    return {"status": "ok", "message": "Battle Squadron personal best saved", "rows_inserted": 1, "score": candidate["score"]}
