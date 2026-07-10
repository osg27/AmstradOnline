import base64
import logging
import os
import re
import shlex
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.mame_leaderboard import MameHighScore, MameLeaderboardGame

logger = logging.getLogger("oldstylegaming.mame_high_scores")

BUILTIN_HI_BCD_PARSER = "mame_hi_bcd"
HI2TXT_PARSER = "hi2txt"
MAME_1942_HI_PARSER = "1942_hi"
TRUXTON_HI_PARSER = "truxton_hi"

MAME_CANONICAL_ROM_ALIASES = {
    # Donkey Kong sets share the same high-score memory layout. Store all of
    # them on the parent leaderboard, but still look for the actual clone .hi.
    "dkongjo": "dkong",
    "dkongjo1": "dkong",
    "dkongj": "dkong",
    "dkongjp": "dkong",
    "dkongjpo": "dkong",
    "dkongo": "dkong",
    "dkongf": "dkong",
    "dkonghrd": "dkong",
    "dkongpe": "dkong",
    "dkongx": "dkong",
    "dkremix": "dkong",
    "dkchrmx": "dkong",
}

DEFAULT_MAME_GAMES = [
    ("puckman", "PuckMan / Pac-Man", HI2TXT_PARSER),
    ("pacman", "Pac-Man", HI2TXT_PARSER),
    ("mspacman", "Ms. Pac-Man", HI2TXT_PARSER),
    ("dkong", "Donkey Kong", BUILTIN_HI_BCD_PARSER),
    ("dkongjr", "Donkey Kong Junior", HI2TXT_PARSER),
    ("dkong3", "Donkey Kong 3", HI2TXT_PARSER),
    ("galaga", "Galaga", HI2TXT_PARSER),
    ("frogger", "Frogger", HI2TXT_PARSER),
    ("1942", "1942", MAME_1942_HI_PARSER),
    ("truxton", "Truxton", TRUXTON_HI_PARSER),
]

ROM_SCORE_LIMITS = {
    # MAME2003 DK variants use a six-digit on-screen score. Anything above this
    # from the raw .hi scan is a false positive from unrelated bytes.
    "dkong": 999990,
    "dkongjr": 999990,
    "dkong3": 999990,
    "1942": 999990,
    "truxton": 9999990,
}

DKONG_HI_GAMES = {
    "dkong",
}

MAME_1942_DEFAULT_SCORES = {
    40000,
    35000,
    30000,
    25000,
    20000,
    9999,
    8888,
    7777,
    6666,
    5555,
    1500,
    1400,
    1300,
    1200,
    1100,
    1000,
    900,
    800,
    700,
    600,
    500,
    400,
    300,
    200,
    100,
}

TRUXTON_DEFAULT_SCORES = {
    50000,
    48000,
    46000,
    44000,
    42000,
    40000,
    38000,
    36000,
    34000,
    32000,
    30000,
    28000,
    26000,
    24000,
    22000,
    20000,
    18000,
    16000,
    14000,
    12000,
}

SUPPORTED_EXACT_HI_GAMES = DKONG_HI_GAMES | {"1942", "truxton"}

UNCALIBRATED_RAW_HI_GAMES = set()

DKONG_FACTORY_HIGH_SCORE = 7650

STATIC_MAME_FILES = {
    "hiscore.dat",
    "retroarch.cfg",
}


@dataclass
class ParsedMameScore:
    score: int
    initials: str | None = None
    rank_in_game: int | None = None


class Hi2txtError(RuntimeError):
    pass


class MameNoPlayerScore(RuntimeError):
    pass


def normalise_rom_name(value: str) -> str:
    return re.sub(r"[^a-z0-9_+-]", "", (value or "").lower().replace(".zip", "").replace(".7z", ""))[:64]


def canonical_mame_rom_name(value: str) -> str:
    rom_name = normalise_rom_name(value)
    return MAME_CANONICAL_ROM_ALIASES.get(rom_name, rom_name)


def is_uncalibrated_mame_game(rom_name: str) -> bool:
    return canonical_mame_rom_name(rom_name) in UNCALIBRATED_RAW_HI_GAMES


def cleanup_uncalibrated_mame_scores(db: Session) -> int:
    untrusted_roms = [
        row[0]
        for row in db.query(MameHighScore.rom_name)
        .filter(MameHighScore.parser == BUILTIN_HI_BCD_PARSER)
        .distinct()
        .all()
        if row[0] not in SUPPORTED_EXACT_HI_GAMES
    ]
    if not untrusted_roms:
        return 0

    deleted = (
        db.query(MameHighScore)
        .filter(
            MameHighScore.parser == BUILTIN_HI_BCD_PARSER,
            MameHighScore.rom_name.in_(untrusted_roms),
        )
        .delete(synchronize_session=False)
    )
    if deleted:
        logger.warning("Removed %s untrusted generic MAME high-score rows", deleted)
        db.commit()
    return deleted


def cleanup_duplicate_mame_scores(db: Session) -> int:
    rows = (
        db.query(MameHighScore)
        .order_by(MameHighScore.created_at, MameHighScore.id)
        .all()
    )
    seen: set[tuple[int, str, int, str, str]] = set()
    duplicate_ids: list[int] = []

    for row in rows:
        key = (
            row.user_id,
            row.rom_name,
            row.score,
            row.initials or "",
            row.parser,
        )
        if key in seen:
            duplicate_ids.append(row.id)
            continue
        seen.add(key)

    if not duplicate_ids:
        return 0

    deleted = (
        db.query(MameHighScore)
        .filter(MameHighScore.id.in_(duplicate_ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    logger.warning("Removed %s duplicate MAME high-score rows", deleted)
    return deleted


def seed_default_mame_games(db: Session) -> None:
    for rom_name, display_name, parser in DEFAULT_MAME_GAMES:
        supported = parser == HI2TXT_PARSER or rom_name in SUPPORTED_EXACT_HI_GAMES
        existing = db.query(MameLeaderboardGame).filter(MameLeaderboardGame.rom_name == rom_name).first()
        if existing:
            existing.display_name = display_name
            existing.leaderboard_supported = supported
            existing.score_source = "hi"
            existing.parser = parser
            existing.enabled = supported
            continue
        db.add(MameLeaderboardGame(
            rom_name=rom_name,
            display_name=display_name,
            leaderboard_supported=supported,
            score_source="hi",
            parser=parser,
            enabled=supported,
        ))
    (
        db.query(MameLeaderboardGame)
        .filter(
            MameLeaderboardGame.parser == BUILTIN_HI_BCD_PARSER,
            ~MameLeaderboardGame.rom_name.in_(SUPPORTED_EXACT_HI_GAMES),
        )
        .update(
            {
                MameLeaderboardGame.leaderboard_supported: False,
                MameLeaderboardGame.enabled: False,
            },
            synchronize_session=False,
        )
    )
    db.commit()
    cleanup_uncalibrated_mame_scores(db)
    cleanup_duplicate_mame_scores(db)


def ensure_hi2txt_game(db: Session, rom_name: str) -> MameLeaderboardGame:
    game = db.query(MameLeaderboardGame).filter(MameLeaderboardGame.rom_name == rom_name).first()
    if game:
        return game

    game = MameLeaderboardGame(
        rom_name=rom_name,
        display_name=rom_name.replace("_", " ").replace("-", " ").strip().title() or rom_name,
        leaderboard_supported=True,
        score_source="hi",
        parser=HI2TXT_PARSER,
        enabled=True,
    )
    db.add(game)
    db.commit()
    db.refresh(game)
    logger.info("Created hi2txt-backed MAME leaderboard entry for %s", rom_name)
    return game


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


def is_mame_hi_source(path: Path, rom_name: str) -> bool:
    name = path.name.lower()
    if name in STATIC_MAME_FILES:
        return False
    if not path.is_file() or not name.endswith(".hi"):
        return False
    return canonical_mame_rom_name(name[:-3]) == canonical_mame_rom_name(rom_name)


def is_nvram_source(path: Path, rom_name: str) -> bool:
    return path.is_dir() and path.name.lower() == rom_name and path.parent.name.lower() == "nvram"


def find_score_source(session_path: Path, rom_name: str, score_source: str) -> Path | None:
    exact_hi_candidates = [
        session_path / f"{rom_name}.hi",
        session_path / "hi" / f"{rom_name}.hi",
        session_path / "hiscore" / f"{rom_name}.hi",
        session_path / "data" / "saves" / f"{rom_name}.hi",
        session_path / "data" / "saves" / "hi" / f"{rom_name}.hi",
        session_path / "data" / "saves" / "hiscore" / f"{rom_name}.hi",
        session_path / "system" / "mame2003-plus" / "hi" / f"{rom_name}.hi",
        session_path / "system" / "mame2003-plus" / f"{rom_name}.hi",
        session_path / "userdata" / "system" / "mame2003-plus" / "hi" / f"{rom_name}.hi",
        session_path / "userdata" / "saves" / "MAME 2003-Plus" / "mame2003-plus" / "hi" / f"{rom_name}.hi",
    ]
    exact_nvram_candidates = [
        session_path / "nvram" / rom_name,
        session_path / "data" / "saves" / "nvram" / rom_name,
    ]
    recursive_hi_candidates = sorted(
        (path for path in session_path.rglob("*.hi") if is_mame_hi_source(path, rom_name)),
        key=lambda path: len(path.parts),
    )
    recursive_nvram_candidates = sorted(
        (path for path in session_path.rglob(rom_name) if is_nvram_source(path, rom_name)),
        key=lambda path: len(path.parts),
    )
    hi_candidates = [path for path in exact_hi_candidates + recursive_hi_candidates if is_mame_hi_source(path, rom_name)]
    nvram_candidates = [path for path in exact_nvram_candidates + recursive_nvram_candidates if is_nvram_source(path, rom_name)]

    if score_source == "hi":
        return next((path for path in hi_candidates if path.exists() and path.is_file()), None)
    if score_source == "nvram":
        return next((path for path in nvram_candidates if path.exists()), None)

    for path in hi_candidates:
        if path.exists() and path.is_file():
            return path
    return next((path for path in nvram_candidates if path.exists()), None)


def decode_bcd_score(chunk: bytes) -> int | None:
    digits: list[str] = []
    for value in chunk:
        high = value >> 4
        low = value & 0x0f
        if high > 9 or low > 9:
            return None
        digits.extend((str(high), str(low)))
    return int("".join(digits))


def plausible_arcade_score(score: int, rom_name: str) -> bool:
    limit = ROM_SCORE_LIMITS.get(rom_name, 9999990)
    return 100 <= score <= limit and score % 10 == 0


def parse_mame_hi_bcd(source_path: Path, rom_name: str) -> list[ParsedMameScore]:
    if not source_path.is_file() or not source_path.name.lower().endswith(".hi") or source_path.name.lower() in STATIC_MAME_FILES:
        raise ValueError(f"Refusing to parse non-score MAME file: {source_path.name}")
    if rom_name in DKONG_HI_GAMES:
        return parse_dkong_hi(source_path)
    logger.warning("MAME .hi source found for %s, but exact parser is not calibrated yet", rom_name)
    return []


def parse_dkong_hi(source_path: Path) -> list[ParsedMameScore]:
    data = source_path.read_bytes()

    # mame2003-plus metadata/hiscore.dat saves dkong as:
    # 0:6100:AA, 0:60B8:03, then six one-byte video RAM sentinels.
    # The 0x60B8 range starts after the first 0xAA bytes. It stores the top
    # score as little-endian BCD: factory bytes 50 76 00 => 007650.
    if len(data) < 173:
        return []

    score = decode_bcd_score(data[170:173][::-1])
    if score is None or score <= DKONG_FACTORY_HIGH_SCORE or not plausible_arcade_score(score, "dkong"):
        return []

    return [ParsedMameScore(score=score, rank_in_game=1)]


def decode_1942_score(row: bytes) -> int | None:
    if len(row) < 5:
        return None
    return decode_bcd_score(row[2:5])


def parse_1942_hi(source_path: Path) -> list[ParsedMameScore]:
    data = source_path.read_bytes()
    if len(data) < 16:
        return []

    parsed: list[ParsedMameScore] = []
    seen: set[int] = set()
    for row_index in range(0, len(data) - (len(data) % 16), 16):
        row = data[row_index:row_index + 16]
        score = decode_1942_score(row)
        if score is None or not plausible_arcade_score(score, "1942") or score in seen:
            continue
        seen.add(score)
        parsed.append(ParsedMameScore(score=score, rank_in_game=len(parsed) + 1))

    player_scores = [score for score in parsed if score.score not in MAME_1942_DEFAULT_SCORES]
    if not player_scores:
        raise MameNoPlayerScore("1942 high-score file found, but only default scores were detected. No player score saved.")

    return sorted(player_scores, key=lambda item: item.score, reverse=True)[:1]


def decode_truxton_score(row: bytes) -> int | None:
    if len(row) != 4:
        return None
    score_units = decode_bcd_score(row)
    if score_units is None:
        return None
    return score_units * 10


def parse_truxton_hi(source_path: Path) -> list[ParsedMameScore]:
    data = source_path.read_bytes()
    if len(data) < 4:
        return []

    parsed: list[ParsedMameScore] = []
    seen: set[int] = set()
    score_table = data[:84]
    for row_index in range(0, len(score_table) - (len(score_table) % 4), 4):
        row = score_table[row_index:row_index + 4]
        score = decode_truxton_score(row)
        if score is None or not plausible_arcade_score(score, "truxton") or score in seen:
            continue
        seen.add(score)
        parsed.append(ParsedMameScore(score=score, rank_in_game=len(parsed) + 1))

    player_scores = [score for score in parsed if score.score not in TRUXTON_DEFAULT_SCORES]
    if not player_scores:
        raise MameNoPlayerScore("Truxton high-score file found, but only default scores were detected. No player score saved.")

    return sorted(player_scores, key=lambda item: item.score, reverse=True)[:1]


def build_hi2txt_commands(rom_name: str, source_path: Path) -> list[list[str]]:
    template = os.getenv("MAME_HI2TXT_COMMAND_TEMPLATE", "").strip()
    if template:
        return [[
            part.format(rom=rom_name, file=str(source_path))
            for part in shlex.split(template, posix=os.name != "nt")
        ]]

    executable = os.getenv("MAME_HI2TXT_PATH", "hi2txt").strip() or "hi2txt"
    resolved = shutil.which(executable) if not Path(executable).exists() else executable
    if not resolved:
        raise Hi2txtError(
            "hi2txt executable not found. Set MAME_HI2TXT_PATH or MAME_HI2TXT_COMMAND_TEMPLATE."
        )
    return [
        [resolved, rom_name, str(source_path)],
        [resolved, str(source_path)],
        [resolved, "-r", rom_name, str(source_path)],
        [resolved, "--rom", rom_name, str(source_path)],
    ]


def parse_hi2txt_output(output: str, rom_name: str) -> list[ParsedMameScore]:
    parsed: list[ParsedMameScore] = []
    seen: set[tuple[int, str]] = set()
    ignored_words = {"RANK", "SCORE", "NAME", "INITIALS", "HI", "HIGH", "PLAYER", "ROM"}

    for line in output.splitlines():
        clean = line.strip()
        if not clean or not any(char.isdigit() for char in clean):
            continue

        numbers = [
            int(match.replace(",", ""))
            for match in re.findall(r"\b\d[\d,]*\b", clean)
            if match.replace(",", "").isdigit()
        ]
        scores = [score for score in numbers if plausible_arcade_score(score, rom_name)]
        if not scores:
            continue

        initials = None
        for token in re.findall(r"\b[A-Z0-9]{2,5}\b", clean.upper()):
            if token not in ignored_words and not token.isdigit():
                initials = token[:5]
                break

        score = max(scores)
        key = (score, initials or "")
        if key in seen:
            continue
        seen.add(key)
        parsed.append(ParsedMameScore(score=score, initials=initials, rank_in_game=len(parsed) + 1))

    return parsed[:10]


def parse_hi2txt(source_path: Path, rom_name: str) -> list[ParsedMameScore]:
    if not source_path.is_file() or not source_path.name.lower().endswith(".hi"):
        raise ValueError(f"Refusing to parse non-score MAME file with hi2txt: {source_path.name}")

    attempts: list[str] = []
    timeout = float(os.getenv("MAME_HI2TXT_TIMEOUT", "10"))
    for command in build_hi2txt_commands(rom_name, source_path):
        logger.info("Running hi2txt for %s: %s", rom_name, command)
        try:
            result = subprocess.run(
                command,
                cwd=str(source_path.parent),
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            attempts.append(f"{command!r} -> {type(exc).__name__}: {exc}")
            continue

        output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
        scores = parse_hi2txt_output(output, rom_name) if result.returncode == 0 else []
        attempts.append(
            f"{command!r} -> exit {result.returncode}, parsed {len(scores)}, output: {output[:500] or '<empty>'}"
        )
        if scores:
            return scores

    message = "hi2txt did not return parseable scores. Attempts: " + " | ".join(attempts)
    logger.warning("%s", message)
    raise Hi2txtError(message[:1800])


def parse_custom_placeholder(source_path: Path, _rom_name: str) -> list[ParsedMameScore]:
    text = source_path.read_bytes().decode("latin-1", errors="ignore")
    scores = sorted({int(value) for value in re.findall(r"\b\d{4,8}\b", text)}, reverse=True)
    return [ParsedMameScore(score=score, rank_in_game=index + 1) for index, score in enumerate(scores[:10])]


def parse_scores(game: MameLeaderboardGame, source_path: Path) -> list[ParsedMameScore]:
    if game.parser == BUILTIN_HI_BCD_PARSER:
        return parse_mame_hi_bcd(source_path, game.rom_name)
    if game.parser == MAME_1942_HI_PARSER:
        return parse_1942_hi(source_path)
    if game.parser == TRUXTON_HI_PARSER:
        return parse_truxton_hi(source_path)
    if game.parser == HI2TXT_PARSER:
        return parse_hi2txt(source_path, game.rom_name)
    if game.parser == "custom":
        return parse_custom_placeholder(source_path, game.rom_name)
    return []


def list_session_files(session_path: Path) -> list[str]:
    return sorted(str(path.relative_to(session_path)).replace("\\", "/") for path in session_path.rglob("*") if path.is_file())


def extract_mame_scores(
    db: Session,
    *,
    session_id: str,
    rom_name: str,
    leaderboard_rom_name: str | None = None,
    user_id: int,
    save_files: list[dict],
) -> dict:
    source_rom_name = normalise_rom_name(rom_name)
    rom_name = canonical_mame_rom_name(leaderboard_rom_name or source_rom_name)
    logger.info(
        "MAME high score extraction started: session=%s rom=%s canonical=%s user=%s",
        session_id,
        source_rom_name,
        rom_name,
        user_id,
    )
    seed_default_mame_games(db)

    game = db.query(MameLeaderboardGame).filter(MameLeaderboardGame.rom_name == rom_name).first()
    if not game:
        game = ensure_hi2txt_game(db, rom_name)

    if not game or not game.enabled or not game.leaderboard_supported:
        logger.info("MAME extraction skipped because ROM is unsupported or disabled: %s", rom_name)
        return {"status": "skipped", "message": "ROM leaderboard is not enabled", "parser": game.parser if game else None}

    root = Path(tempfile.gettempdir()) / "oldstylegaming-mame-sessions"
    session_path = root / re.sub(r"[^a-zA-Z0-9_.-]", "_", session_id) / source_rom_name
    if session_path.exists():
        shutil.rmtree(session_path)
    session_path.mkdir(parents=True, exist_ok=True)
    logger.info("MAME extraction session path used: %s", session_path)

    try:
        write_save_files(session_path, save_files)
        saved_paths = list_session_files(session_path)
        logger.info("MAME extraction received %s save files: %s", len(saved_paths), saved_paths[:20])
        source_path = find_score_source(session_path, source_rom_name, game.score_source)
        if not source_path:
            logger.info("MAME score source not found: session=%s rom=%s", session_id, rom_name)
            file_hint = f" Received files: {', '.join(saved_paths[:8])}" if saved_paths else " No save files were received."
            return {
                "status": "no_scores",
                "message": f"No .hi or nvram score source found.{file_hint}",
                "parser": game.parser,
                "saved_paths": saved_paths,
            }

        logger.info("MAME score source found: %s", source_path)
        try:
            parsed_scores = parse_scores(game, source_path)
        except MameNoPlayerScore as exc:
            logger.info("MAME score source found but no player score was detected: session=%s rom=%s message=%s", session_id, rom_name, exc)
            return {
                "status": "no_scores",
                "message": str(exc),
                "parser": game.parser,
                "source_path": str(source_path.relative_to(session_path)),
                "saved_paths": saved_paths,
                "scores_parsed": 0,
                "rows_inserted": 0,
            }
        except Hi2txtError as exc:
            logger.warning("hi2txt extraction failed: session=%s rom=%s error=%s", session_id, rom_name, exc)
            return {
                "status": "failed",
                "message": str(exc),
                "parser": game.parser,
                "source_path": str(source_path.relative_to(session_path)),
                "saved_paths": saved_paths,
            }
        except Exception as exc:
            logger.exception("MAME score parser failed: session=%s rom=%s", session_id, rom_name)
            return {
                "status": "failed",
                "message": str(exc),
                "parser": game.parser,
                "source_path": str(source_path.relative_to(session_path)),
                "saved_paths": saved_paths,
            }
        if not parsed_scores:
            logger.info("MAME score source was found but no calibrated scores were parsed: session=%s rom=%s", session_id, rom_name)
            return {
                "status": "no_scores",
                "message": "Score file found, but this game needs an exact .hi parser before scores can be trusted.",
                "parser": game.parser,
                "source_path": str(source_path.relative_to(session_path)),
                "saved_paths": saved_paths,
                "scores_parsed": 0,
                "rows_inserted": 0,
            }
        inserted = 0
        for parsed in parsed_scores:
            exists = db.query(MameHighScore).filter(
                MameHighScore.user_id == user_id,
                MameHighScore.rom_name == rom_name,
                MameHighScore.score == parsed.score,
                MameHighScore.initials == parsed.initials,
                MameHighScore.parser == game.parser,
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
        cleanup_duplicate_mame_scores(db)
        return {
            "status": "ok",
            "rom_name": rom_name,
            "message": "Score already saved." if inserted == 0 and parsed_scores else None,
            "parser": game.parser,
            "source_path": str(source_path.relative_to(session_path)),
            "saved_paths": saved_paths,
            "scores_parsed": len(parsed_scores),
            "rows_inserted": inserted,
        }
    finally:
        if os.getenv("MAME_KEEP_EXTRACTION_FILES", "").lower() in {"1", "true", "yes", "on"}:
            logger.info("Keeping MAME extraction files for debugging: %s", session_path)
        else:
            shutil.rmtree(session_path, ignore_errors=True)
