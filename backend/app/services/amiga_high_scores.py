import re
from collections import Counter


BATTLE_SQUADRON_GAME_KEY = "battle-squadron"
BATTLE_SQUADRON_PARSER = "battle-squadron-lodsco-v1"
_BATTLE_SQUADRON_ROW = re.compile(rb"^\s*\d+\.\s+(.{3})\s+(\d{8})$")


def parse_battle_squadron_lodsco(data: bytes) -> list[dict]:
    """Parse the PAL WHDLoad LODSCO table (12 fixed 20-byte rows)."""
    if len(data) != 240:
        return []

    rows = []
    for offset in range(0, len(data), 20):
        match = _BATTLE_SQUADRON_ROW.match(data[offset + 4:offset + 20])
        if not match:
            return []
        initials = match.group(1).decode("latin-1", errors="replace").strip().upper()
        score = int(match.group(2))
        rows.append({"initials": initials or "---", "score": score})
    return rows


def find_new_battle_squadron_scores(current: bytes, baseline: bytes) -> list[dict]:
    current_rows = parse_battle_squadron_lodsco(current)
    baseline_rows = parse_battle_squadron_lodsco(baseline)
    if not current_rows or not baseline_rows:
        return []

    baseline_counts = Counter((row["initials"], row["score"]) for row in baseline_rows)
    new_rows = []
    for row in current_rows:
        key = (row["initials"], row["score"])
        if baseline_counts[key]:
            baseline_counts[key] -= 1
        elif row["score"] > 0:
            new_rows.append(row)
    return sorted(new_rows, key=lambda row: row["score"], reverse=True)
