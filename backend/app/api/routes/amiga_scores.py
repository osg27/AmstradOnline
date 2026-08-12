import base64
import binascii
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.database import get_db
from app.models.amiga_leaderboard import AmigaHighScore
from app.models.user import User
from app.schemas.amiga_leaderboard import AmigaLeaderboardEntry, AmigaScoreExtractionRequest
from app.highscores.amiga.comparison import find_new_scores
from app.highscores.amiga.registry import get_extractor, list_extractors, resolve_extractor


router = APIRouter(prefix="/scores/amiga", tags=["amiga-scores"])
logger = logging.getLogger(__name__)


def _decode(value: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="Invalid Amiga score file") from exc


@router.get("/leaderboards/{game_key}", response_model=list[AmigaLeaderboardEntry])
def get_amiga_leaderboard(game_key: str, db: Session = Depends(get_db)):
    extractor = get_extractor(game_key)
    if not extractor:
        raise HTTPException(status_code=404, detail="Amiga leaderboard not found")
    rows = (
        db.query(AmigaHighScore, User.username)
        .join(User, AmigaHighScore.user_id == User.id)
        .filter(AmigaHighScore.game_key == extractor.key)
        .order_by(desc(AmigaHighScore.score), AmigaHighScore.created_at)
        .limit(10)
        .all()
    )
    return [
        AmigaLeaderboardEntry(rank=index, username=username, score=row.score, initials=row.initials)
        for index, (row, username) in enumerate(rows, start=1)
    ]


@router.get("/games")
def get_supported_amiga_games():
    return [extractor.public_metadata() for extractor in list_extractors()]


@router.get("/games/resolve")
def resolve_supported_amiga_game(title: str = Query(min_length=1, max_length=512)):
    extractor = resolve_extractor(title)
    if not extractor:
        raise HTTPException(status_code=404, detail="No Amiga high-score extractor for this game")
    return extractor.public_metadata()


@router.post("/extract-score")
def extract_amiga_score(
    payload: AmigaScoreExtractionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    extractor = get_extractor(payload.game_key)
    if not extractor:
        raise HTTPException(status_code=404, detail="Amiga leaderboard not found")
    if payload.source_path.rsplit("/", 1)[-1].upper() != extractor.filename.upper():
        logger.warning("Rejected %s score source path: %s", extractor.key, payload.source_path)
        raise HTTPException(status_code=400, detail=f"{extractor.title} {extractor.filename} file required")

    current_data = _decode(payload.data)
    baseline_data = _decode(payload.baseline_data)
    logger.info(
        "Parsing Amiga score data game=%s source=%s current=%d baseline=%d",
        extractor.key, payload.source_path, len(current_data), len(baseline_data),
    )
    try:
        current_rows = extractor.extract(current_data)
        baseline_rows = extractor.extract(baseline_data)
    except (ValueError, UnicodeError) as exc:
        logger.warning("Rejected invalid %s score data from %s: %s", extractor.key, payload.source_path, exc)
        raise HTTPException(status_code=422, detail=f"Invalid {extractor.title} score data: {exc}") from exc
    candidates = find_new_scores(current_rows, baseline_rows)
    logger.info("Amiga score comparison game=%s detected=%d", extractor.key, len(candidates))
    if not candidates:
        return {
            "status": "no_scores",
            "message": f"No new saved {extractor.title} score found",
            "rows_inserted": 0,
            "current_bytes": len(current_data),
            "baseline_bytes": len(baseline_data),
            "current_rows": len(current_rows),
            "baseline_rows": len(baseline_rows),
        }

    candidate = candidates[0]
    existing = db.query(AmigaHighScore).filter(
        AmigaHighScore.user_id == user.id,
        AmigaHighScore.game_key == extractor.key,
    ).first()
    if existing and existing.score >= candidate["score"]:
        return {"status": "ok", "message": "Score checked; personal best unchanged", "rows_inserted": 0}

    if existing:
        existing.score = candidate["score"]
        existing.initials = candidate["name"]
        existing.session_id = payload.session_id
        existing.source_path = payload.source_path
        existing.parser = extractor.parser
    else:
        db.add(AmigaHighScore(
            user_id=user.id,
            game_key=extractor.key,
            score=candidate["score"],
            initials=candidate["name"],
            session_id=payload.session_id,
            source_path=payload.source_path,
            parser=extractor.parser,
        ))
    db.commit()
    logger.info("Saved Amiga personal best game=%s user=%s score=%d", extractor.key, user.id, candidate["score"])
    return {"status": "ok", "message": f"{extractor.title} personal best saved", "rows_inserted": 1, "score": candidate["score"]}
