import base64
import logging
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.mame_leaderboard import MameHighScore, MameLeaderboardGame

logger = logging.getLogger("oldstylegaming.mame_high_scores")

DEFAULT_MAME_GAMES = [
    ("pacman", "Pac-Man"),
    ("dkong", "Donkey Kong"),
    ("galaga", "Galaga"),
    ("frogger", "Frogger"),
    ("1942", "1942"),
]


@dataclass
class ParsedMameScore:
    score: int
    initials: str | None = None
    rank_in_game: int | None = None


def normalise_rom_name(value: str) -> str:
    return re.sub(r"[^a-z0-9_+-]", "", (value or "").lower().replace(".zip", "").replace(".7z", ""))[:64]


def seed_default_mame_games(db: Session) -> None:
    for rom_name, display_name in DEFAULT_MAME_GAMES:
        existing = db.query(MameLeaderboardGame).filter(MameLeaderboardGame.rom_name == rom_name).first()
        if existing:
            continue
        db.add(MameLeaderboardGame(
            rom_name=rom_name,
            display_name=display_name,
            leaderboard_supported=True,
            score_source="hi",
            parser="hi2txt",
            enabled=False,
        ))
    db.commit()


def write_save_files(session_path: Path, save_files: list[dict]) -> None:
    for item in save_files:
        relative_path = Path(str(item.get("path") or "").replace("\\", "/"))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            logger.warning("Skipping unsafe MAME save path: %s", relative_path)
            continue

        try:
            data = base64.b64decode(item.get("data") or "", validate=True)
        except ValueError:
            logger.warning("Skipping invalid base64 MAME save path: %s", relative_path)
            continue
        target = session_path / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def find_score_source(session_path: Path, rom_name: str, score_source: str) -> Path | None:
    hi_candidates = [
        session_path / f"{rom_name}.hi",
        session_path / "hi" / f"{rom_name}.hi",
        session_path / "hiscore" / f"{rom_name}.hi",
        session_path / "data" / "saves" / f"{rom_name}.hi",
        session_path / "data" / "saves" / "hi" / f"{rom_name}.hi",
        session_path / "data" / "saves" / "hiscore" / f"{rom_name}.hi",
    ]
    nvram_candidates = [
        session_path / "nvram" / rom_name,
        session_path / "data" / "saves" / "nvram" / rom_name,
    ]

    if score_source == "hi":
        return next((path for path in hi_candidates if path.exists() and path.is_file()), None)
    if score_source == "nvram":
        return next((path for path in nvram_candidates if path.exists()), None)

    for path in hi_candidates:
        if path.exists() and path.is_file():
            return path
    return next((path for path in nvram_candidates if path.exists()), None)


def parse_hi2txt(source_path: Path, rom_name: str) -> list[ParsedMameScore]:
    command = ["hi2txt", "-r", rom_name, str(source_path)]
    logger.info("Running MAME hi2txt parser: %s", " ".join(command))
    result = subprocess.run(command, capture_output=True, text=True, timeout=10, check=False)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "hi2txt failed").strip())

    scores: list[ParsedMameScore] = []
    for line in result.stdout.splitlines():
        numbers = re.findall(r"\b\d{2,}\b", line.replace(",", ""))
        if not numbers:
            continue
        score = max(int(number) for number in numbers)
        initials_match = re.search(r"\b[A-Z0-9]{2,4}\b", line.upper())
        rank_match = re.match(r"\s*(\d+)[).:\s]", line)
        scores.append(ParsedMameScore(
            score=score,
            initials=initials_match.group(0) if initials_match else None,
            rank_in_game=int(rank_match.group(1)) if rank_match else len(scores) + 1,
        ))
    return scores


def parse_custom_placeholder(source_path: Path, _rom_name: str) -> list[ParsedMameScore]:
    text = source_path.read_bytes().decode("latin-1", errors="ignore")
    scores = sorted({int(value) for value in re.findall(r"\b\d{4,8}\b", text)}, reverse=True)
    return [ParsedMameScore(score=score, rank_in_game=index + 1) for index, score in enumerate(scores[:10])]


def parse_scores(game: MameLeaderboardGame, source_path: Path) -> list[ParsedMameScore]:
    if game.parser == "hi2txt":
        return parse_hi2txt(source_path, game.rom_name)
    if game.parser == "custom":
        return parse_custom_placeholder(source_path, game.rom_name)
    return []


def extract_mame_scores(
    db: Session,
    *,
    session_id: str,
    rom_name: str,
    user_id: int,
    save_files: list[dict],
) -> dict:
    rom_name = normalise_rom_name(rom_name)
    logger.info("MAME high score extraction started: session=%s rom=%s user=%s", session_id, rom_name, user_id)
    seed_default_mame_games(db)

    game = db.query(MameLeaderboardGame).filter(MameLeaderboardGame.rom_name == rom_name).first()
    if not game or not game.enabled or not game.leaderboard_supported:
        logger.info("MAME extraction skipped because ROM is unsupported or disabled: %s", rom_name)
        return {"status": "skipped", "message": "ROM leaderboard is not enabled", "parser": game.parser if game else None}

    root = Path(tempfile.gettempdir()) / "oldstylegaming-mame-sessions"
    session_path = root / re.sub(r"[^a-zA-Z0-9_.-]", "_", session_id) / rom_name
    if session_path.exists():
        shutil.rmtree(session_path)
    session_path.mkdir(parents=True, exist_ok=True)
    logger.info("MAME extraction session path used: %s", session_path)

    try:
        write_save_files(session_path, save_files)
        source_path = find_score_source(session_path, rom_name, game.score_source)
        if not source_path:
            logger.info("MAME score source not found: session=%s rom=%s", session_id, rom_name)
            return {"status": "no_scores", "message": "No .hi or nvram score source found", "parser": game.parser}

        logger.info("MAME score source found: %s", source_path)
        try:
            parsed_scores = parse_scores(game, source_path)
        except Exception as exc:
            logger.exception("MAME score parser failed: session=%s rom=%s", session_id, rom_name)
            return {
                "status": "failed",
                "message": str(exc),
                "parser": game.parser,
                "source_path": str(source_path.relative_to(session_path)),
            }
        inserted = 0
        for parsed in parsed_scores:
            exists = db.query(MameHighScore).filter(
                MameHighScore.user_id == user_id,
                MameHighScore.rom_name == rom_name,
                MameHighScore.score == parsed.score,
                MameHighScore.initials == parsed.initials,
                MameHighScore.rank_in_game == parsed.rank_in_game,
                MameHighScore.session_id == session_id,
            ).first()
            if exists:
                continue
            db.add(MameHighScore(
                user_id=user_id,
                rom_name=rom_name,
                score=parsed.score,
                initials=parsed.initials,
                rank_in_game=parsed.rank_in_game,
                session_id=session_id,
                source_path=str(source_path.relative_to(session_path)),
                parser=game.parser,
            ))
            inserted += 1
        db.commit()
        logger.info("MAME scores parsed=%s inserted=%s", len(parsed_scores), inserted)
        return {
            "status": "ok",
            "parser": game.parser,
            "source_path": str(source_path.relative_to(session_path)),
            "scores_parsed": len(parsed_scores),
            "rows_inserted": inserted,
        }
    finally:
        shutil.rmtree(session_path, ignore_errors=True)
