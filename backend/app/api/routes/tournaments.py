import base64
import json
import os
import random
import string
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import desc
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user, is_admin_user
from app.core.database import get_db
from app.models.tournament import Tournament, TournamentEntry, TournamentNotification, TournamentScore
from app.models.user import User
from app.schemas.tournament import TournamentScoreSubmit
from app.services.mame_high_scores import (
    extract_mame_scores,
    load_supported_mame_games,
    load_tournament_mame_hi_sizes,
    normalise_rom_name,
)


router = APIRouter(prefix="/tournaments", tags=["tournaments"])
CODE_CHARS = string.ascii_uppercase + string.digits
TOURNAMENT_HI_TEMPLATES_PATH = Path(__file__).resolve().parents[2] / "data" / "mame_tournament_hi_templates.json"
TOURNAMENT_NAMES_PATH = Path(__file__).resolve().parents[2] / "data" / "mame_tournament_names.json"
TOURNAMENT_ROM_DIR = Path(os.getenv("TOURNAMENT_ROM_DIR", Path(__file__).resolve().parents[2] / "storage" / "tournaments"))
MAX_TOURNAMENT_ROM_BYTES = 256 * 1024 * 1024


def load_tournament_hi_templates() -> dict[str, dict]:
    try:
        payload = json.loads(TOURNAMENT_HI_TEMPLATES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {
        normalise_rom_name(rom_name): config
        for rom_name, config in payload.items()
        if isinstance(config, dict)
        and isinstance(config.get("template"), str)
        and isinstance(config.get("score_rule"), dict)
    }


def load_tournament_names() -> dict[str, str]:
    try:
        payload = json.loads(TOURNAMENT_NAMES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {
        normalise_rom_name(rom_name): str(display_name).strip()
        for rom_name, display_name in payload.items()
        if str(display_name).strip()
    }


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
        "is_creator": tournament.creator_user_id == user_id,
        "starts_at": tournament.starts_at,
        "ends_at": tournament.ends_at,
        "status": tournament_status(tournament),
        "joined": joined,
        "entry_count": entry_count,
        "is_public": bool(tournament.is_public),
    }


def can_manage_tournament(tournament: Tournament, user: User) -> bool:
    return is_admin_user(user)


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


def tournament_ready_games() -> list[dict]:
    hi_sizes = load_tournament_mame_hi_sizes()
    hi_templates = load_tournament_hi_templates()
    canonical_names = load_tournament_names()
    games = []
    for rom_name, display_name, _parser in load_supported_mame_games():
        if rom_name in hi_sizes and rom_name in hi_templates:
            games.append({
                "rom_name": rom_name,
                "display_name": canonical_names.get(rom_name) or display_name or rom_name,
                "system": "MAME Arcade",
                "file_name": f"{rom_name}.zip",
                "hi_size": hi_sizes[rom_name],
            })
    return sorted(games, key=lambda game: (game["display_name"].casefold(), game["rom_name"]))


@router.get("/games")
def tournament_games(_user: User = Depends(get_current_user)):
    if not is_admin_user(_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    return tournament_ready_games()


@router.post("")
def create_tournament(
    name: str = Form(..., min_length=3, max_length=120),
    rom_name: str = Form(..., min_length=1, max_length=64),
    duration_hours: int = Form(..., ge=1, le=24 * 30),
    is_public: bool = Form(True),
    rom_file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")
    rom_name = normalise_rom_name(rom_name)
    ready_game = next((item for item in tournament_ready_games() if item["rom_name"] == rom_name), None)
    if not ready_game:
        raise HTTPException(status_code=400, detail="That MAME game is not tournament-ready")

    uploaded_name = Path(rom_file.filename or "").name
    if not uploaded_name.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Tournament ROM must be a ZIP file")
    if normalise_rom_name(uploaded_name) != rom_name:
        raise HTTPException(status_code=400, detail=f"Upload {rom_name}.zip for the selected game")
    starts_at = utc_now()
    tournament = Tournament(
        code="".join(random.choice(CODE_CHARS) for _ in range(8)),
        name=name.strip(),
        creator_user_id=user.id,
        rom_name=rom_name,
        display_name=ready_game["display_name"],
        rom_file_name=uploaded_name,
        is_public=is_public,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=duration_hours),
    )
    while db.query(Tournament).filter(Tournament.code == tournament.code).first():
        tournament.code = "".join(random.choice(CODE_CHARS) for _ in range(8))
    TOURNAMENT_ROM_DIR.mkdir(parents=True, exist_ok=True)
    target = TOURNAMENT_ROM_DIR / f"{tournament.code}.zip"
    temporary = target.with_suffix(".upload")
    written = 0
    try:
        with temporary.open("wb") as output:
            while chunk := rom_file.file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_TOURNAMENT_ROM_BYTES:
                    raise HTTPException(status_code=413, detail="Tournament ROM exceeds the 256 MB limit")
                output.write(chunk)
        if written == 0:
            raise HTTPException(status_code=400, detail="Tournament ROM is empty")
        temporary.replace(target)
        db.add(tournament)
        db.flush()
        db.add(TournamentEntry(tournament_id=tournament.id, user_id=user.id))
        db.commit()
    except Exception:
        db.rollback()
        temporary.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        raise
    db.refresh(tournament)
    return serialize_tournament(tournament, db, user.id)


@router.get("/mine")
def my_tournaments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Tournament).join(
        TournamentEntry, TournamentEntry.tournament_id == Tournament.id,
    ).filter(TournamentEntry.user_id == user.id).order_by(desc(Tournament.created_at)).limit(50).all()
    return [serialize_tournament(item, db, user.id) for item in rows]


@router.get("/public")
def public_tournaments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Tournament).filter(
        Tournament.is_public.is_(True),
    ).order_by(desc(Tournament.created_at)).limit(100).all()
    return [serialize_tournament(item, db, user.id) for item in rows]


@router.get("/notifications")
def tournament_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(TournamentNotification, Tournament, User.username)
        .join(Tournament, Tournament.id == TournamentNotification.tournament_id)
        .join(User, User.id == TournamentNotification.actor_user_id)
        .filter(
            TournamentNotification.recipient_user_id == user.id,
            TournamentNotification.is_read.is_(False),
        )
        .order_by(TournamentNotification.created_at, TournamentNotification.id)
        .limit(20)
        .all()
    )
    return [
        {
            "id": notification.id,
            "tournament_code": tournament.code,
            "tournament_name": tournament.name,
            "game_name": tournament.display_name,
            "username": username,
            "score": notification.actor_score,
            "created_at": notification.created_at,
        }
        for notification, tournament, username in rows
    ]


@router.patch("/notifications/{notification_id}/read")
def read_tournament_notification(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notification = db.query(TournamentNotification).filter(
        TournamentNotification.id == notification_id,
        TournamentNotification.recipient_user_id == user.id,
    ).first()
    if not notification:
        raise HTTPException(status_code=404, detail="Tournament notification not found")
    notification.is_read = True
    db.commit()
    return {"read": True}


@router.get("/{code}")
def tournament_details(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tournament = get_tournament(code, db)
    return {**serialize_tournament(tournament, db, user.id), "can_delete": can_manage_tournament(tournament, user)}


@router.delete("/{code}")
def delete_tournament(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tournament = get_tournament(code, db)
    if not can_manage_tournament(tournament, user):
        raise HTTPException(status_code=403, detail="Only an admin can delete tournaments")
    db.query(TournamentNotification).filter(TournamentNotification.tournament_id == tournament.id).delete(
        synchronize_session=False,
    )
    db.query(TournamentScore).filter(TournamentScore.tournament_id == tournament.id).delete(
        synchronize_session=False,
    )
    db.query(TournamentEntry).filter(TournamentEntry.tournament_id == tournament.id).delete(
        synchronize_session=False,
    )
    db.delete(tournament)
    db.commit()
    (TOURNAMENT_ROM_DIR / f"{tournament.code}.zip").unlink(missing_ok=True)
    return {"deleted": True, "code": tournament.code}


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
            "created_at": score.achieved_at,
        }
        for index, (score, username) in enumerate(rows)
    ]


@router.delete("/{code}/leaderboard")
def reset_tournament_leaderboard(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tournament = get_tournament(code, db)
    if tournament.creator_user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the tournament creator can reset its standings")
    db.query(TournamentNotification).filter(TournamentNotification.tournament_id == tournament.id).delete(
        synchronize_session=False,
    )
    deleted = db.query(TournamentScore).filter(TournamentScore.tournament_id == tournament.id).delete(
        synchronize_session=False,
    )
    db.commit()
    return {"deleted": deleted}


@router.get("/{code}/game")
def tournament_game(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tournament = get_tournament(code, db)
    require_entry(tournament, user, db)
    if tournament_status(tournament) != "active":
        raise HTTPException(status_code=409, detail="Tournament play is not currently active")
    filename = tournament.rom_file_name
    hi_config = load_tournament_hi_templates().get(tournament.rom_name)
    hi_template = hi_config.get("template") if hi_config else None
    if not filename or not hi_template or not (TOURNAMENT_ROM_DIR / f"{tournament.code}.zip").is_file():
        raise HTTPException(status_code=404, detail="Tournament ROM is unavailable")
    try:
        hi_size = len(base64.b64decode(hi_template, validate=True))
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Tournament high-score template is invalid") from exc
    return {
        "id": f"tournament:{tournament.code}:{tournament.rom_name}",
        "title": tournament.display_name,
        "file_name": filename,
        "rom_name": tournament.rom_name,
        "save_namespace": f"tournament-{tournament.code}-entrant-{user.id}",
        "hi_size": hi_size,
        "hi_template": hi_template,
    }


@router.get("/{code}/files/{filename}")
def tournament_file(code: str, filename: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tournament = get_tournament(code, db)
    require_entry(tournament, user, db)
    if tournament_status(tournament) != "active" or filename != tournament.rom_file_name:
        raise HTTPException(status_code=404, detail="Tournament ROM is unavailable")
    target = TOURNAMENT_ROM_DIR / f"{tournament.code}.zip"
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Tournament ROM is unavailable")
    return FileResponse(
        target,
        media_type="application/zip",
        filename=filename,
        headers={"Cache-Control": "private, max-age=3600"},
    )


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
        tournament_rule=(load_tournament_hi_templates().get(tournament.rom_name) or {}).get("score_rule"),
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
    previous_best = existing.score if existing else -1
    if existing:
        if improved:
            existing.score = int(best["score"])
            existing.initials = best.get("initials")
            existing.session_id = session_id[:128]
            existing.achieved_at = now
            existing.updated_at = now
    else:
        db.add(TournamentScore(
            tournament_id=tournament.id,
            user_id=user.id,
            score=int(best["score"]),
            initials=best.get("initials"),
            session_id=session_id[:128],
            achieved_at=now,
            updated_at=now,
        ))
    if improved:
        overtaken_scores = db.query(TournamentScore).filter(
            TournamentScore.tournament_id == tournament.id,
            TournamentScore.user_id != user.id,
            TournamentScore.score > previous_best,
            TournamentScore.score < int(best["score"]),
        ).all()
        for overtaken_score in overtaken_scores:
            db.add(TournamentNotification(
                tournament_id=tournament.id,
                recipient_user_id=overtaken_score.user_id,
                actor_user_id=user.id,
                actor_score=int(best["score"]),
                created_at=now,
            ))
    db.commit()
    return {**result, "rows_inserted": 1 if improved else 0, "tournament_best": int(best["score"]), "improved": improved}
