"""Compatibility wrappers for callers predating the generic Amiga framework."""

from app.highscores.amiga.comparison import find_new_scores
from app.highscores.amiga.registry import EXTRACTORS


_BATTLE_SQUADRON = EXTRACTORS["battle-squadron"]
BATTLE_SQUADRON_GAME_KEY = _BATTLE_SQUADRON.key
BATTLE_SQUADRON_PARSER = _BATTLE_SQUADRON.parser


def parse_battle_squadron_lodsco(data: bytes) -> list[dict]:
    """Parse the PAL WHDLoad LODSCO table (12 fixed 20-byte rows)."""
    try:
        return [
            {"initials": row["name"], "score": row["score"]}
            for row in _BATTLE_SQUADRON.extract(data)
        ]
    except ValueError:
        return []


def find_new_battle_squadron_scores(current: bytes, baseline: bytes) -> list[dict]:
    current_rows = parse_battle_squadron_lodsco(current)
    baseline_rows = parse_battle_squadron_lodsco(baseline)
    if not current_rows or not baseline_rows:
        return []

    return [
        {"initials": row["name"], "score": row["score"]}
        for row in find_new_scores(
            [{"name": row["initials"], "score": row["score"]} for row in current_rows],
            [{"name": row["initials"], "score": row["score"]} for row in baseline_rows],
        )
    ]
