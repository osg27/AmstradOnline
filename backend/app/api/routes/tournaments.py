import random
import string
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import urlopen

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import desc
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user, is_vip_user
from app.api.routes.vip_mame import (
    ARCHIVE_DOWNLOAD_ROOT,
    archive_request,
    load_archive_catalog,
    stream_archive_response,
)
from app.core.database import get_db
from app.models.mame_leaderboard import MameLeaderboardGame
from app.models.tournament import Tournament, TournamentEntry, TournamentScore
from app.models.user import User
from app.schemas.tournament import TournamentCreate, TournamentScoreSubmit
from app.services.mame_high_scores import extract_mame_scores, normalise_rom_name, seed_default_mame_games


router = APIRouter(prefix="/tournaments", tags=["tournaments"])
CODE_CHARS = string.ascii_uppercase + string.digits


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def tournament_status(tournament: Tournament) -> str:
    now = utc_now()
    if now < aware(tournament.starts_at):
        return "upcoming"
    if now >= aware(tournament.ends_at):
        return "completed"
    return "active"


def serialize_tournament(tournament: Tournament, db: Session, user_id: int) -> dict:
    entry_count = db.query(TournamentEntry).filter(TournamentEntry.tournament_id == tournament.id).count()
    joined = db.query(TournamentEntry).filter(
        TournamentEntry.tournament_id == tournament.id,
        TournamentEntry.user_id == user_id,
    ).first() is not None
    return {
        "code": tournament.code,
        "name": tournament.name,
        "rom_name": tournament.rom_name,
        "display_name": tournament.display_name,
        "creator_user_id": tournament.creator_user_id,
        "starts_at": tournament.starts_at,
        "ends_at": tournament.ends_at,
        "status": tournament_status(tournament),
        "joined": joined,
        "entry_count": entry_count,
    }


def get_tournament(code: str, db: Session) -> Tournament:
    tournament = db.query(Tournament).filter(Tournament.code == code.upper()).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return tournament


def require_entry(tournament: Tournament, user: User, db: Session) -> None:
    entry = db.query(TournamentEntry).filter(
        TournamentEntry.tournament_id == tournament.id,
        TournamentEntry.user_id == user.id,
    ).first()
    if not entry:
        raise HTTPException(status_code=403, detail="Join this tournament before playing")


@router.get("/games")
def tournament_games(_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not is_vip_user(_user):
        raise HTTPException(status_code=403, detail="Only VIPs can create tournaments")
    seed_default_mame_games(db)
    archive_roms = set(load_archive_catalog()["roms"])
    games = db.query(MameLeaderboardGame).filter(
        MameLeaderboardGame.enabled == True,  # noqa: E712
        MameLeaderboardGame.leaderboard_supported == True,  # noqa: E712
    ).order_by(MameLeaderboardGame.display_name).all()
    return [
        {"rom_name": game.rom_name, "display_name": game.display_name}
        for game in games
        if f"{game.rom_name}.zip" in archive_roms
    ]


@router.post("")
def create_tournament(
    payload: TournamentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not is_vip_user(user):
        raise HTTPException(status_code=403, detail="Only VIPs can create tournaments")
    seed_default_mame_games(db)
    rom_name = normalise_rom_name(payload.rom_name)
    game = db.query(MameLeaderboardGame).filter(
        MameLeaderboardGame.rom_name == rom_name,
        MameLeaderboardGame.enabled == True,  # noqa: E712
        MameLeaderboardGame.leaderboard_supported == True,  # noqa: E712
    ).first()
    if not game or f"{rom_name}.zip" not in set(load_archive_catalog()["roms"]):
        raise HTTPException(status_code=400, detail="That MAME game is not tournament-ready")

    starts_at = payload.starts_at or utc_now()
    starts_at = aware(starts_at).astimezone(timezone.utc)
    if starts_at < utc_now() - timedelta(minutes=2):
        raise HTTPException(status_code=400, detail="Start time cannot be in the past")
    tournament = Tournament(
        code="".join(random.choice(CODE_CHARS) for _ in range(8)),
        name=payload.name.strip(),
        creator_user_id=user.id,
        rom_name=rom_name,
        display_name=game.display_name or rom_name,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=payload.duration_hours),
    )
    while db.query(Tournament).filter(Tournament.code == tournament.code).first():
        tournament.code = "".join(random.choice(CODE_CHARS) for _ in range(8))
    db.add(tournament)
    db.flush()
    db.add(TournamentEntry(tournament_id=tournament.id, user_id=user.id))
    db.commit()
    db.refresh(tournament)
    return serialize_tournament(tournament, db, user.id)


@router.get("/mine")
def my_tournaments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Tournament).join(
        TournamentEntry, TournamentEntry.tournament_id == Tournament.id,
    ).filter(TournamentEntry.user_id == user.id).order_by(desc(Tournament.created_at)).limit(50).all()
    return [serialize_tournament(item, db, user.id) for item in rows]


@router.get("/{code}")
def tournament_details(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return serialize_tournament(get_tournament(code, db), db, user.id)


@router.post("/{code}/join")
def join_tournament(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tournament = get_tournament(code, db)
    try:
        db.add(TournamentEntry(tournament_id=tournament.id, user_id=user.id))
        db.commit()
    except IntegrityError:
        db.rollback()
    return serialize_tournament(tournament, db, user.id)


@router.get("/{code}/leaderboard")
def tournament_leaderboard(
    code: str,
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tournament = get_tournament(code, db)
    require_entry(tournament, user, db)
    rows = db.query(TournamentScore, User.username).join(
        User, User.id == TournamentScore.user_id,
    ).filter(TournamentScore.tournament_id == tournament.id).order_by(
        desc(TournamentScore.score), TournamentScore.achieved_at,
    ).limit(limit).all()
    return [
        {
            "rank": index + 1,
            "username": username,
            "initials": score.initials,
            "score": score.score,
            "attempts": score.attempts,
            "created_at": score.achieved_at,
        }
        for index, (score, username) in enumerate(rows)
    ]


@router.get("/{code}/game")
def tournament_game(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tournament = get_tournament(code, db)
    require_entry(tournament, user, db)
    if tournament_status(tournament) != "active":
        raise HTTPException(status_code=409, detail="Tournament play is not currently active")
    return {
        "id": f"tournament:{tournament.code}:{tournament.rom_name}",
        "title": tournament.display_name,
        "file_name": f"{tournament.rom_name}.zip",
        "rom_name": tournament.rom_name,
    }


@router.get("/{code}/files/{filename}")
def tournament_file(code: str, filename: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tournament = get_tournament(code, db)
    require_entry(tournament, user, db)
    if tournament_status(tournament) != "active" or filename != f"{tournament.rom_name}.zip":
        raise HTTPException(status_code=404, detail="Tournament ROM is unavailable")
    if filename not in load_archive_catalog()["roms"]:
        raise HTTPException(status_code=404, detail="Tournament ROM is unavailable")
    try:
        response = urlopen(archive_request(f"{ARCHIVE_DOWNLOAD_ROOT}/roms/{quote(filename)}"), timeout=60)
    except HTTPError as exc:
        raise HTTPException(status_code=502, detail="Tournament ROM download failed") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Tournament ROM download failed: {exc}") from exc
    headers = {"Cache-Control": "private, max-age=3600"}
    if response.headers.get("Content-Length"):
        headers["Content-Length"] = response.headers["Content-Length"]
    return StreamingResponse(stream_archive_response(response), media_type="application/zip", headers=headers)


@router.post("/{code}/sessions/{session_id}/extract-score")
def extract_tournament_score(
    code: str,
    session_id: str,
    payload: TournamentScoreSubmit,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tournament = get_tournament(code, db)
    require_entry(tournament, user, db)
    if tournament_status(tournament) != "active":
        raise HTTPException(status_code=409, detail="Tournament has finished")
    if normalise_rom_name(payload.rom_name) != tournament.rom_name:
        raise HTTPException(status_code=400, detail="Wrong game for this tournament")
    result = extract_mame_scores(
        db,
        session_id=f"tournament-{tournament.id}-{session_id}"[:128],
        rom_name=tournament.rom_name,
        leaderboard_rom_name=tournament.rom_name,
        user_id=user.id,
        username=user.username,
        save_files=[item.model_dump() for item in payload.save_files],
        baseline_save_files=[item.model_dump() for item in payload.baseline_save_files],
        persist=False,
    )
    player_scores = result.get("player_scores") or []
    if not player_scores:
        return {**result, "rows_inserted": 0}
    best = max(player_scores, key=lambda item: int(item["score"]))
    existing = db.query(TournamentScore).filter(
        TournamentScore.tournament_id == tournament.id,
        TournamentScore.user_id == user.id,
    ).first()
    now = utc_now()
    improved = existing is None or int(best["score"]) > existing.score
    if existing:
        existing.attempts += 1
        existing.updated_at = now
        if improved:
            existing.score = int(best["score"])
            existing.initials = best.get("initials")
            existing.session_id = session_id[:128]
            existing.achieved_at = now
    else:
        db.add(TournamentScore(
            tournament_id=tournament.id,
            user_id=user.id,
            score=int(best["score"]),
            initials=best.get("initials"),
            attempts=1,
            session_id=session_id[:128],
            achieved_at=now,
            updated_at=now,
        ))
    db.commit()
    return {**result, "rows_inserted": 1 if improved else 0, "tournament_best": int(best["score"]), "improved": improved}
