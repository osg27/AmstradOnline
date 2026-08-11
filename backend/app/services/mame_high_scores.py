import base64
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.mame_leaderboard import MameHighScore, MameLeaderboardGame

logger = logging.getLogger("oldstylegaming.mame_high_scores")

BUILTIN_HI_BCD_PARSER = "mame_hi_bcd"
HI2TXT_PARSER = "hi2txt"
CONFIGURED_HI_PARSER = "configured_hi"
TAPPER_NVRAM_PARSER = "tapper_nvram"

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
    # Midway MCR Tapper variants use the same 2 KB NVRAM score table.
    "tappera": "tapper",
    "rbtapper": "tapper",
    "sutapper": "tapper",
}

DEFAULT_MAME_GAMES = [
    ("puckman", "Pac-Man", HI2TXT_PARSER),
    ("pacman", "Pac-Man", HI2TXT_PARSER),
    ("mspacman", "Ms. Pac-Man", HI2TXT_PARSER),
    ("dkong", "Donkey Kong", BUILTIN_HI_BCD_PARSER),
    ("dkongjr", "Donkey Kong Junior", HI2TXT_PARSER),
    ("dkong3", "Donkey Kong 3", HI2TXT_PARSER),
    ("galaga", "Galaga", HI2TXT_PARSER),
    ("frogger", "Frogger", HI2TXT_PARSER),
    ("tapper", "Tapper", TAPPER_NVRAM_PARSER),
]

BASE_ROM_SCORE_LIMITS = {
    # MAME2003 DK variants use a six-digit on-screen score. Anything above this
    # from the raw .hi scan is a false positive from unrelated bytes.
    "dkong": 999990,
    "dkongjr": 999990,
    "dkong3": 999990,
}

DKONG_HI_GAMES = {
    "dkong",
}

MAME_HI_RULES_PATH = Path(__file__).resolve().parents[1] / "data" / "mame_hi_rules.json"
MAME_HI2TXT_ROMS_PATH = Path(__file__).resolve().parents[1] / "data" / "mame_hi2txt_roms.json"
MAME_TOURNAMENT_ROMS_PATH = Path(__file__).resolve().parents[1] / "data" / "mame_tournament_roms.json"
MAME_TOURNAMENT_HI_SIZES_PATH = Path(__file__).resolve().parents[1] / "data" / "mame_tournament_hi_sizes.json"
DISABLED_MAME_SCORE_GAMES = {
    # MAME2003-Plus writes Robotron scores to nvram in this browser setup, but
    # the exported file has repeatedly contained only the factory/default tables.
    # Keep the parser code for diagnostics, but do not advertise/save it.
    "robotron",
}


def normalise_rom_name_value(value: str) -> str:
    return re.sub(r"[^a-z0-9_+-]", "", (value or "").lower().replace(".zip", "").replace(".7z", ""))[:64]


def load_mame_hi_rules() -> dict[str, dict]:
    try:
        raw = json.loads(MAME_HI_RULES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not load MAME .hi rules from %s: %s", MAME_HI_RULES_PATH, exc)
        return {}
    return {normalise_rom_name_value(rom_name): rule for rom_name, rule in raw.items() if isinstance(rule, dict)}


CONFIGURED_MAME_HI_RULES = load_mame_hi_rules()
CONFIGURED_HI_GAMES = set(CONFIGURED_MAME_HI_RULES) - DISABLED_MAME_SCORE_GAMES
ROM_SCORE_LIMITS = {
    **BASE_ROM_SCORE_LIMITS,
    **{
        rom_name: int(rule["max_score"])
        for rom_name, rule in CONFIGURED_MAME_HI_RULES.items()
        if isinstance(rule.get("max_score"), int)
    },
}
ROM_SCORE_GRANULARITY = {
    rom_name: int(rule.get("score_granularity", 10))
    for rom_name, rule in CONFIGURED_MAME_HI_RULES.items()
    if int(rule.get("score_granularity", 10)) > 0
}
SUPPORTED_EXACT_HI_GAMES = (DKONG_HI_GAMES | CONFIGURED_HI_GAMES) - DISABLED_MAME_SCORE_GAMES
SUPPORTED_EXACT_HI_GAMES.add("tapper")
DEFAULT_MAME_GAMES.extend(
    (
        rom_name,
        str(rule.get("display_name") or rom_name).strip() or rom_name,
        CONFIGURED_HI_PARSER,
    )
    for rom_name, rule in CONFIGURED_MAME_HI_RULES.items()
)

UNCALIBRATED_RAW_HI_GAMES = set()

DKONG_FACTORY_SCORES = {
    7650,
    6100,
    5950,
    5050,
    4300,
}

STATIC_MAME_FILES = {
    "hiscore.dat",
    "retroarch.cfg",
}


def hi2txt_xml_dirs() -> list[Path]:
    raw = os.getenv("MAME_HI2TXT_XML_DIR", "").strip()
    dirs: list[Path] = []
    if raw:
        dirs.extend(Path(part).expanduser() for part in raw.split(os.pathsep) if part.strip())

    default_dirs = [
        Path(__file__).resolve().parents[1] / "data" / "hi2txt-xml",
        Path(__file__).resolve().parents[3] / "hi2txt-xml" / "src" / "main" / "db",
        Path(__file__).resolve().parents[3] / "hi2txt-xml",
        Path("/opt/amstrad-multiplayer/tools/hi2txt-xml"),
        Path("/opt/amstrad-multiplayer/tools/hi2txt-xml/src/main/db"),
        Path("/opt/amstrad-multiplayer/tools/hi2txt/xml"),
    ]
    dirs.extend(default_dirs)

    seen: set[str] = set()
    unique: list[Path] = []
    for directory in dirs:
        key = str(directory)
        if key in seen:
            continue
        seen.add(key)
        unique.append(directory)
    return unique


def _hi2txt_display_name(xml_path: Path) -> str:
    try:
        root = ET.parse(xml_path).getroot()
    except (ET.ParseError, OSError):
        return xml_path.stem

    label = str(root.attrib.get("label") or "").strip()
    if label:
        return label
    same_as = root.find("sameas")
    target = str(same_as.attrib.get("id") or "").strip() if same_as is not None else ""
    if target:
        target_path = xml_path.with_name(f"{target}.xml")
        if target_path.is_file() and target_path != xml_path:
            return _hi2txt_display_name(target_path)
    return xml_path.stem.replace("_", " ").replace("-", " ").strip().title() or xml_path.stem


@lru_cache(maxsize=1)
def load_hi2txt_xml_games() -> tuple[tuple[str, str, str], ...]:
    games: dict[str, str] = {}
    for directory in hi2txt_xml_dirs():
        if not directory.is_dir():
            continue
        for xml_path in directory.rglob("*.xml"):
            rom_name = normalise_rom_name_value(xml_path.stem)
            if not rom_name or rom_name in DISABLED_MAME_SCORE_GAMES or rom_name in games:
                continue
            games[rom_name] = _hi2txt_display_name(xml_path)

    if games:
        logger.info("Loaded %s hi2txt XML game definitions", len(games))
    return tuple((rom_name, display_name, HI2TXT_PARSER) for rom_name, display_name in sorted(games.items()))


@lru_cache(maxsize=1)
def load_supported_mame_games() -> tuple[tuple[str, str, str], ...]:
    """Return trusted score-capable games without touching the database."""
    games = {
        normalise_rom_name_value(rom_name): (normalise_rom_name_value(rom_name), display_name, parser)
        for rom_name, display_name, parser in DEFAULT_MAME_GAMES
    }
    xml_games = load_hi2txt_xml_games()
    for rom_name, display_name, parser in xml_games:
        games.setdefault(rom_name, (rom_name, display_name, parser))
    try:
        manifest_roms = json.loads(MAME_HI2TXT_ROMS_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not load fallback hi2txt ROM manifest from %s: %s", MAME_HI2TXT_ROMS_PATH, exc)
        manifest_roms = []
    for value in manifest_roms:
        rom_name = normalise_rom_name_value(str(value))
        if rom_name and rom_name not in DISABLED_MAME_SCORE_GAMES:
            display_name = rom_name.replace("_", " ").replace("-", " ").strip().title() or rom_name
            games.setdefault(rom_name, (rom_name, display_name, HI2TXT_PARSER))
    if manifest_roms and not xml_games:
        logger.info("Loaded %s fallback hi2txt ROM definitions", len(manifest_roms))
    return tuple(
        game
        for game in games.values()
        if game[0] not in DISABLED_MAME_SCORE_GAMES
        and (game[2] in {HI2TXT_PARSER, TAPPER_NVRAM_PARSER} or game[0] in SUPPORTED_EXACT_HI_GAMES)
    )


@lru_cache(maxsize=1)
def load_tournament_mame_roms() -> tuple[str, ...]:
    """Exact Archive filenames known to have a trusted score definition."""
    try:
        filenames = json.loads(MAME_TOURNAMENT_ROMS_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Could not load tournament MAME manifest from %s: %s", MAME_TOURNAMENT_ROMS_PATH, exc)
        return ()
    return tuple(
        str(filename)
        for filename in filenames
        if re.fullmatch(r"[a-zA-Z0-9_.+ -]+\.zip", str(filename))
    )


@lru_cache(maxsize=1)
def load_tournament_mame_hi_sizes() -> dict[str, int]:
    try:
        values = json.loads(MAME_TOURNAMENT_HI_SIZES_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Could not load tournament MAME .hi sizes from %s: %s", MAME_TOURNAMENT_HI_SIZES_PATH, exc)
        return {}
    return {
        normalise_rom_name_value(rom_name): int(size)
        for rom_name, size in values.items()
        if 0 < int(size) <= 1024 * 1024
    }


@dataclass
class ParsedMameScore:
    score: int
    initials: str | None = None
    rank_in_game: int | None = None


@dataclass
class FilteredMameScores:
    scores: list[ParsedMameScore]
    expected_initials: list[str]
    parsed_scores: list[dict]
    baseline_scores: list[dict]


class Hi2txtError(RuntimeError):
    pass


class MameNoPlayerScore(RuntimeError):
    pass


def normalise_rom_name(value: str) -> str:
    return normalise_rom_name_value(value)


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
        .order_by(MameHighScore.user_id, MameHighScore.rom_name, MameHighScore.score.desc(), MameHighScore.created_at, MameHighScore.id)
        .all()
    )
    seen: set[tuple[int, str]] = set()
    duplicate_ids: list[int] = []

    for row in rows:
        key = (row.user_id, row.rom_name)
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
    logger.warning("Removed %s lower duplicate MAME high-score rows", deleted)
    return deleted


def seed_default_mame_games(db: Session) -> None:
    for rom_name, display_name, parser in load_supported_mame_games():
        supported = True
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
            MameLeaderboardGame.rom_name.in_(DISABLED_MAME_SCORE_GAMES),
        )
        .update(
            {
                MameLeaderboardGame.leaderboard_supported: False,
                MameLeaderboardGame.enabled: False,
            },
            synchronize_session=False,
        )
    )
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
    name = path.name.lower()
    expected = normalise_rom_name(rom_name)
    if path.parent.name.lower() != "nvram":
        return False
    if path.is_dir():
        return normalise_rom_name(name) == expected
    if path.is_file():
        candidate_name = name[:-3] if name.endswith(".nv") else name
        return normalise_rom_name(candidate_name) == expected
    return False


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
        session_path / "nvram" / f"{rom_name}.nv",
        session_path / "data" / "saves" / "nvram" / rom_name,
        session_path / "data" / "saves" / "nvram" / f"{rom_name}.nv",
        session_path / "data" / "saves" / "MAME 2003-Plus" / "mame2003-plus" / "nvram" / rom_name,
        session_path / "data" / "saves" / "MAME 2003-Plus" / "mame2003-plus" / "nvram" / f"{rom_name}.nv",
    ]
    recursive_hi_candidates = sorted(
        (path for path in session_path.rglob("*.hi") if is_mame_hi_source(path, rom_name)),
        key=lambda path: len(path.parts),
    )
    recursive_nvram_candidates = sorted(
        (
            path
            for pattern in (rom_name, f"{rom_name}.nv")
            for path in session_path.rglob(pattern)
            if is_nvram_source(path, rom_name)
        ),
        key=lambda path: len(path.parts),
    )
    hi_candidates = [path for path in exact_hi_candidates + recursive_hi_candidates if is_mame_hi_source(path, rom_name)]
    nvram_candidates = [path for path in exact_nvram_candidates + recursive_nvram_candidates if is_nvram_source(path, rom_name)]

    if score_source == "hi":
        hi_source = next((path for path in hi_candidates if path.exists() and path.is_file()), None)
        if hi_source:
            return hi_source
        return next((path for path in nvram_candidates if path.exists()), None)
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
    granularity = ROM_SCORE_GRANULARITY.get(rom_name, 10)
    return 100 <= score <= limit and score % granularity == 0


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
    # The 0x60B8 range starts after the first 0xAA bytes. Scores are stored as
    # little-endian BCD. The file contains five fixed 34-byte leaderboard rows,
    # with each three-byte score at row offset 29. Do not scan arbitrary byte
    # windows: unrelated row data can be valid BCD and previously produced
    # false scores such as 900,000.
    row_size = 34
    score_offset = 29
    row_count = 5
    if len(data) < (row_count - 1) * row_size + score_offset + 3:
        return []

    parsed: list[ParsedMameScore] = []
    seen: set[int] = set()
    for row_index in range(row_count):
        offset = row_index * row_size + score_offset
        score = decode_bcd_score(data[offset:offset + 3][::-1])
        if score is None:
            continue
        if score in DKONG_FACTORY_SCORES or not plausible_arcade_score(score, "dkong") or score in seen:
            continue
        seen.add(score)
        parsed.append(ParsedMameScore(score=score, rank_in_game=row_index + 1))

    return sorted(parsed, key=lambda item: item.score, reverse=True)


def decode_configured_hi_score(chunk: bytes, encoding: str) -> int | None:
    if encoding == "bcd_be":
        return decode_bcd_score(chunk)
    if encoding == "bcd_le":
        return decode_bcd_score(chunk[::-1])
    if encoding == "int_be":
        return int.from_bytes(chunk, "big", signed=False)
    if encoding == "int_le":
        return int.from_bytes(chunk, "little", signed=False)
    if encoding == "williams_bcd_pairs":
        return decode_bcd_score(chunk[1::2])
    raise ValueError(f"Unsupported MAME .hi score encoding: {encoding}")


def decode_robotron_text(chunk: bytes) -> str | None:
    if len(chunk) % 2:
        return None

    chars: list[str] = []
    for index in range(0, len(chunk), 2):
        high = chunk[index] & 0x0f
        low = chunk[index + 1] & 0x0f
        value = (high << 4) | low
        if value == 0x3a:
            chars.append(" ")
        elif 32 <= value <= 126:
            chars.append(chr(value))
        else:
            chars.append(" ")

    return "".join(chars).strip() or None


def decode_robotron_decimal_nibbles(chunk: bytes) -> int | None:
    digits: list[str] = []
    for value in chunk:
        digit = value & 0x0f
        if digit > 9:
            return None
        digits.append(str(digit))
    return int("".join(digits))


def parse_robotron_nvram(source_path: Path) -> list[ParsedMameScore]:
    data = source_path.read_bytes()
    all_time_defaults = {10000}

    # Robotron stores the normal player-entered scores in the lower "All Time
    # Heroes" table. Its NVRAM fields use Williams' odd-nibble layout: each
    # physical byte contributes its low nibble, so names are two bytes per
    # character and scores are seven decimal nibbles.
    all_time_scores: list[ParsedMameScore] = []
    seen: set[int] = set()
    all_time_offset = 0x168
    row_size = 14
    for row_index in range(37):
        start = all_time_offset + (row_index * row_size)
        row = data[start:start + row_size]
        if len(row) < row_size:
            break
        initials = decode_robotron_text(row[0:6])
        raw_score = decode_robotron_decimal_nibbles(row[7:14])
        if raw_score is None:
            continue
        score = raw_score
        if score in all_time_defaults or not plausible_arcade_score(score, "robotron") or score in seen:
            continue
        seen.add(score)
        all_time_scores.append(ParsedMameScore(score=score, initials=initials, rank_in_game=row_index + 1))

    if all_time_scores:
        return sorted(all_time_scores, key=lambda item: item.score, reverse=True)[:1]

    try:
        return parse_configured_hi_table(source_path, "robotron")
    except MameNoPlayerScore as exc:
        raise MameNoPlayerScore(
            "Robotron score source was found, but only the factory/default tables were detected. "
            "No player all-time score was saved."
        ) from exc


def parse_configured_hi_table(source_path: Path, rom_name: str) -> list[ParsedMameScore]:
    rule = CONFIGURED_MAME_HI_RULES.get(rom_name)
    if not rule:
        return []

    data = source_path.read_bytes()
    score_offset = int(rule.get("score_offset", 0))
    row_size = int(rule["row_size"])
    row_count = int(rule.get("row_count") or 0)
    score_start = int(rule.get("score_start", 0))
    score_length = int(rule["score_length"])
    multiplier = int(rule.get("multiplier", 1))
    encoding = str(rule.get("encoding", "bcd_be"))
    default_scores = {int(score) for score in rule.get("default_scores", [])}

    if row_size <= 0 or score_length <= 0:
        raise ValueError(f"Invalid MAME .hi parser rule for {rom_name}: row_size and score_length must be positive")
    if score_start < 0 or score_start + score_length > row_size:
        raise ValueError(f"Invalid MAME .hi parser rule for {rom_name}: score bytes must fit inside row")

    table = data[score_offset:]
    if row_count > 0:
        table = table[:row_count * row_size]

    parsed: list[ParsedMameScore] = []
    seen: set[int] = set()
    for row_index in range(0, len(table) - (len(table) % row_size), row_size):
        row = table[row_index:row_index + row_size]
        raw_score = decode_configured_hi_score(row[score_start:score_start + score_length], encoding)
        if raw_score is None:
            continue
        score = raw_score * multiplier
        if not plausible_arcade_score(score, rom_name) or score in seen:
            continue
        seen.add(score)
        parsed.append(ParsedMameScore(score=score, rank_in_game=len(parsed) + 1))

    player_scores = [score for score in parsed if score.score not in default_scores]
    if not player_scores:
        display_name = str(rule.get("display_name") or rom_name)
        raise MameNoPlayerScore(f"{display_name} high-score file found, but only default scores were detected. No player score saved.")

    return sorted(player_scores, key=lambda item: item.score, reverse=True)[:1]


def parse_configured_hi(source_path: Path, rom_name: str) -> list[ParsedMameScore]:
    if rom_name == "robotron":
        return parse_robotron_nvram(source_path)

    return parse_configured_hi_table(source_path, rom_name)


def parse_tapper_nvram(source_path: Path) -> list[ParsedMameScore]:
    """Decode the Midway MCR table shared by Tapper, Domino Man and Journey."""
    if source_path.is_dir():
        legacy_source = source_path / "nvram"
        if legacy_source.is_file():
            source_path = legacy_source
    if not source_path.is_file():
        raise ValueError(f"Tapper NVRAM score source is not a file: {source_path.name}")

    data = source_path.read_bytes()
    if len(data) < 80:
        raise ValueError(f"Tapper NVRAM is too short ({len(data)} bytes; expected a 2 KB block)")

    # The table starts after a 7-byte header, a 6-byte odd-nibble top-score
    # field, and another 7 reserved bytes. It contains ten rows of three name
    # bytes followed by a three-byte big-endian packed-BCD score.
    table_offset = 20
    row_size = 6
    parsed: list[ParsedMameScore] = []
    seen: set[tuple[int, str]] = set()
    for row_index in range(10):
        start = table_offset + row_index * row_size
        row = data[start:start + row_size]
        if len(row) != row_size:
            break
        score = decode_bcd_score(row[3:6])
        if score is None or not plausible_arcade_score(score, "tapper"):
            continue
        initials = "".join(chr(value) if 32 <= value <= 126 else " " for value in row[:3]).strip() or None
        key = (score, initials or "")
        if key in seen:
            continue
        seen.add(key)
        parsed.append(ParsedMameScore(score=score, initials=initials, rank_in_game=row_index + 1))

    return sorted(parsed, key=lambda item: item.score, reverse=True)


def find_uploaded_hiscore_dat(source_path: Path) -> Path | None:
    for parent in source_path.parents:
        candidates = [
            parent / "home" / "web_user" / "retroarch" / "system" / "mame2003-plus" / "hiscore.dat",
            parent / "system" / "mame2003-plus" / "hiscore.dat",
            parent / "mame2003-plus" / "hiscore.dat",
            parent / "hiscore.dat",
        ]
        for candidate in candidates:
            if candidate.is_file():
                return candidate
    return None


def build_hi2txt_descr_commands(executable: str, rom_name: str, source_path: Path) -> list[list[str]]:
    commands: list[list[str]] = []
    hiscore_dat = find_uploaded_hiscore_dat(source_path)

    for descr_dir in hi2txt_xml_dirs():
        if not descr_dir.is_dir():
            continue

        base = [executable, "-descr", str(descr_dir)]
        if hiscore_dat:
            base.extend(["-hiscoredat", str(hiscore_dat)])

        # This mirrors the command style used by hi2txt-xml's own Gradle tests.
        commands.append([*base, "-rd", "-notrace", str(source_path)])
        commands.append([*base, "-notrace", str(source_path)])
        commands.append([*base, str(source_path)])
        commands.append([*base, rom_name, str(source_path)])

    return commands


def build_hi2txt_commands(rom_name: str, source_path: Path) -> list[list[str]]:
    template = os.getenv("MAME_HI2TXT_COMMAND_TEMPLATE", "").strip()
    if template:
        return [[
            part.format(rom=rom_name, file=str(source_path))
            for part in shlex.split(template, posix=os.name != "nt")
        ]]

    executable = os.getenv("MAME_HI2TXT_PATH", "hi2txt").strip() or "hi2txt"
    resolved = shutil.which(executable) if not Path(executable).exists() else executable
    if resolved:
        return [
            *build_hi2txt_descr_commands(str(resolved), rom_name, source_path),
            [str(resolved), rom_name, str(source_path)],
            [str(resolved), str(source_path)],
            [str(resolved), "-r", rom_name, str(source_path)],
            [str(resolved), "--rom", rom_name, str(source_path)],
        ]

    jar_candidates = [
        Path(os.getenv("MAME_HI2TXT_JAR_PATH", "")).expanduser() if os.getenv("MAME_HI2TXT_JAR_PATH") else None,
        Path("/opt/amstrad-multiplayer/tools/hi2txt/hi2txt.jar"),
    ]
    java = shutil.which(os.getenv("MAME_HI2TXT_JAVA", "java"))
    for jar_path in (candidate for candidate in jar_candidates if candidate):
        if java and jar_path.is_file():
            jar_command = [java, "-jar", str(jar_path)]
            return [
                *[
                    [*jar_command, *command[1:]]
                    for command in build_hi2txt_descr_commands("hi2txt", rom_name, source_path)
                ],
                [java, "-jar", str(jar_path), rom_name, str(source_path)],
                [java, "-jar", str(jar_path), str(source_path)],
                [java, "-jar", str(jar_path), "-r", rom_name, str(source_path)],
                [java, "-jar", str(jar_path), "--rom", rom_name, str(source_path)],
            ]

    raise Hi2txtError(
        "hi2txt executable not found. Set MAME_HI2TXT_PATH, MAME_HI2TXT_JAR_PATH, or MAME_HI2TXT_COMMAND_TEMPLATE."
    )


def parse_hi2txt_output(output: str, rom_name: str, minimum_score: int = 100) -> list[ParsedMameScore]:
    parsed: list[ParsedMameScore] = []
    seen: set[tuple[int, str]] = set()
    ignored_words = {"RANK", "SCORE", "NAME", "INITIALS", "HI", "HIGH", "PLAYER", "ROM"}
    score_column = None

    for line in output.splitlines():
        clean = line.strip()
        columns = [column.strip() for column in clean.split("|")]
        upper_columns = [column.upper() for column in columns]
        if "SCORE" in upper_columns:
            score_column = upper_columns.index("SCORE")
            continue
        if not clean or not any(char.isdigit() for char in clean):
            continue

        if score_column is not None and score_column < len(columns):
            value = columns[score_column].replace(",", "").strip()
            scores = [int(value)] if value.isdigit() and int(value) >= minimum_score else []
        else:
            numbers = [
                int(match.replace(",", ""))
                for match in re.findall(r"\b\d[\d,]*\b", clean)
                if match.replace(",", "").isdigit()
            ]
            scores = [
                score for score in numbers
                if score >= minimum_score and (minimum_score < 100 or plausible_arcade_score(score, rom_name))
            ]
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


def parse_hi2txt(source_path: Path, rom_name: str, minimum_score: int = 100) -> list[ParsedMameScore]:
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
        scores = parse_hi2txt_output(output, rom_name, minimum_score) if result.returncode == 0 else []
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
    if source_path.is_file() and source_path.name.lower().endswith(".nv") and game.parser == HI2TXT_PARSER:
        raise MameNoPlayerScore(
            f"{game.display_name or game.rom_name} nvram score file found, but this game needs an exact nvram parser before scores can be trusted."
        )
    if game.parser == BUILTIN_HI_BCD_PARSER:
        return parse_mame_hi_bcd(source_path, game.rom_name)
    if game.parser == CONFIGURED_HI_PARSER:
        return parse_configured_hi(source_path, game.rom_name)
    if game.parser == TAPPER_NVRAM_PARSER:
        return parse_tapper_nvram(source_path)
    if game.parser == HI2TXT_PARSER:
        return parse_hi2txt(source_path, game.rom_name)
    if game.parser == "custom":
        return parse_custom_placeholder(source_path, game.rom_name)
    return []


def parse_tournament_hi_scores(source_path: Path, rule: dict) -> list[ParsedMameScore]:
    """Decode a tournament table directly, independently of normal leaderboard thresholds."""
    if rule.get("parser") == "hi2txt":
        return parse_hi2txt(source_path, source_path.stem, max(1, int(rule.get("minimum_score", 1))))
    data = source_path.read_bytes()
    offset = int(rule.get("offset", 0))
    stride = int(rule.get("stride", 0))
    count = int(rule.get("count", 0))
    length = int(rule.get("length", 0))
    multiplier = max(1, int(rule.get("multiplier", 1)))
    minimum_score = max(1, int(rule.get("minimum_score", 1)))
    if rule.get("encoding") != "packed_bcd" or min(offset, stride, count, length) < 0 or not stride or not count or not length:
        raise ValueError("Invalid tournament high-score rule")
    if offset + ((count - 1) * stride) + length > len(data):
        raise ValueError("Tournament high-score file is shorter than its configured rule")

    parsed: list[ParsedMameScore] = []
    for index in range(count):
        chunk = data[offset + (index * stride):offset + (index * stride) + length]
        raw_score = decode_bcd_score(chunk)
        score = raw_score * multiplier if raw_score is not None else None
        if score is not None and score >= minimum_score:
            parsed.append(ParsedMameScore(score=score, rank_in_game=index + 1))
    return sorted(parsed, key=lambda item: item.score, reverse=True)


def normalise_initials(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())[:5]


def serialize_parsed_scores(scores: list[ParsedMameScore]) -> list[dict]:
    return [
        {
            "score": score.score,
            "initials": score.initials,
            "rank_in_game": score.rank_in_game,
        }
        for score in scores
    ]


def parsed_score_identity(score: ParsedMameScore) -> tuple[int, str]:
    return (score.score, normalise_initials(score.initials))


def scores_added_since_baseline(
    current_scores: list[ParsedMameScore],
    baseline_scores: list[ParsedMameScore],
) -> list[ParsedMameScore]:
    baseline_counts = Counter(parsed_score_identity(score) for score in baseline_scores)
    added: list[ParsedMameScore] = []
    for score in current_scores:
        key = parsed_score_identity(score)
        if baseline_counts[key] > 0:
            baseline_counts[key] -= 1
            continue
        added.append(score)
    return added


def filter_hi2txt_player_scores(
    *,
    db: Session,
    game: MameLeaderboardGame,
    rom_name: str,
    user_id: int,
    username: str | None,
    current_scores: list[ParsedMameScore],
    baseline_scores: list[ParsedMameScore] | None = None,
) -> FilteredMameScores:
    parsed_debug = serialize_parsed_scores(current_scores)
    baseline_debug = serialize_parsed_scores(baseline_scores or [])
    if game.parser != HI2TXT_PARSER:
        return FilteredMameScores(scores=current_scores, expected_initials=[], parsed_scores=parsed_debug, baseline_scores=baseline_debug)

    if baseline_scores is not None:
        added_scores = scores_added_since_baseline(current_scores, baseline_scores)
        if added_scores:
            return FilteredMameScores(
                scores=sorted(added_scores, key=lambda item: item.score, reverse=True)[:1],
                expected_initials=[],
                parsed_scores=parsed_debug,
                baseline_scores=baseline_debug,
            )
        raise MameNoPlayerScore(
            f"{game.display_name or game.rom_name} score table was decoded, but the current table matched the start-of-game snapshot."
        )

    raise MameNoPlayerScore(
        f"{game.display_name or game.rom_name} needs a start-of-game score snapshot before a player score can be identified."
    )


def list_session_files(session_path: Path) -> list[str]:
    return sorted(str(path.relative_to(session_path)).replace("\\", "/") for path in session_path.rglob("*") if path.is_file())


def extract_mame_scores(
    db: Session,
    *,
    session_id: str,
    rom_name: str,
    leaderboard_rom_name: str | None = None,
    user_id: int,
    username: str | None = None,
    save_files: list[dict],
    baseline_save_files: list[dict] | None = None,
    persist: bool = True,
    tournament_rule: dict | None = None,
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
    baseline_path = session_path.parent / f"{session_path.name}-baseline"
    if session_path.exists():
        shutil.rmtree(session_path)
    if baseline_path.exists():
        shutil.rmtree(baseline_path)
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
        parsed_scores_debug: list[dict] = []
        baseline_scores_debug: list[dict] = []
        expected_initials: list[str] = []
        try:
            parsed_scores = parse_tournament_hi_scores(source_path, tournament_rule) if tournament_rule else parse_scores(game, source_path)
            parsed_scores_debug = serialize_parsed_scores(parsed_scores)
            baseline_scores: list[ParsedMameScore] | None = None
            if baseline_save_files:
                baseline_path.mkdir(parents=True, exist_ok=True)
                write_save_files(baseline_path, baseline_save_files)
                baseline_source = find_score_source(baseline_path, source_rom_name, game.score_source)
                if baseline_source:
                    baseline_scores = parse_tournament_hi_scores(baseline_source, tournament_rule) if tournament_rule else parse_scores(game, baseline_source)
                    baseline_scores_debug = serialize_parsed_scores(baseline_scores)
            if tournament_rule:
                if baseline_scores is None:
                    raise MameNoPlayerScore("Tournament score needs a start-of-game snapshot.")
                added_scores = scores_added_since_baseline(parsed_scores, baseline_scores)
                if not added_scores:
                    raise MameNoPlayerScore("No new tournament score was found since the previous snapshot.")
                filtered_scores = FilteredMameScores(
                    scores=sorted(added_scores, key=lambda item: item.score, reverse=True)[:1],
                    expected_initials=[],
                    parsed_scores=serialize_parsed_scores(parsed_scores),
                    baseline_scores=serialize_parsed_scores(baseline_scores),
                )
            else:
                filtered_scores = filter_hi2txt_player_scores(
                    db=db,
                    game=game,
                    rom_name=rom_name,
                    user_id=user_id,
                    username=username,
                    current_scores=parsed_scores,
                    baseline_scores=baseline_scores,
                )
            parsed_scores = filtered_scores.scores
            parsed_scores_debug = filtered_scores.parsed_scores
            baseline_scores_debug = filtered_scores.baseline_scores
            expected_initials = filtered_scores.expected_initials
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
                "parsed_scores": parsed_scores_debug,
                "baseline_scores": baseline_scores_debug,
                "expected_initials": expected_initials,
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
                "parsed_scores": parsed_scores_debug,
                "baseline_scores": baseline_scores_debug,
                "expected_initials": expected_initials,
            }
        player_scores = serialize_parsed_scores(parsed_scores)
        if not persist:
            return {
                "status": "ok",
                "rom_name": rom_name,
                "message": None,
                "parser": game.parser,
                "source_path": str(source_path.relative_to(session_path)),
                "saved_paths": saved_paths,
                "scores_parsed": len(parsed_scores),
                "rows_inserted": 0,
                "parsed_scores": parsed_scores_debug,
                "player_scores": player_scores,
                "baseline_scores": baseline_scores_debug,
                "expected_initials": expected_initials,
            }

        inserted = 0
        updated = 0
        for parsed in parsed_scores:
            existing = db.query(MameHighScore).filter(
                MameHighScore.user_id == user_id,
                MameHighScore.rom_name == rom_name,
            ).order_by(MameHighScore.score.desc(), MameHighScore.created_at, MameHighScore.id).first()
            if existing and parsed.score <= existing.score:
                continue
            if existing:
                existing.score = parsed.score
                existing.initials = parsed.initials
                existing.rank_in_game = parsed.rank_in_game
                existing.session_id = session_id
                existing.source_path = str(source_path.relative_to(session_path))
                existing.parser = game.parser
                existing.created_at = datetime.now(timezone.utc)
                updated += 1
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
        logger.info("MAME scores parsed=%s inserted=%s updated=%s", len(parsed_scores), inserted, updated)
        cleanup_duplicate_mame_scores(db)
        return {
            "status": "ok",
            "rom_name": rom_name,
            "message": "Personal best unchanged." if inserted == 0 and updated == 0 and parsed_scores else None,
            "parser": game.parser,
            "source_path": str(source_path.relative_to(session_path)),
            "saved_paths": saved_paths,
            "scores_parsed": len(parsed_scores),
            "rows_inserted": inserted + updated,
            "parsed_scores": parsed_scores_debug,
            "player_scores": player_scores,
            "baseline_scores": baseline_scores_debug,
            "expected_initials": expected_initials,
        }
    finally:
        if os.getenv("MAME_KEEP_EXTRACTION_FILES", "").lower() in {"1", "true", "yes", "on"}:
            logger.info("Keeping MAME extraction files for debugging: %s", session_path)
        else:
            shutil.rmtree(session_path, ignore_errors=True)
            shutil.rmtree(baseline_path, ignore_errors=True)
