import re


EXPECTED_SIZE = 240
RECORD_SIZE = 20
RECORD_COUNT = 12
_ENTRY = re.compile(rb"^(\s*\d+)\.\s+(.{3})\s+(\d{8})$")


class InvalidBattleSquadronScoreData(ValueError):
    """Raised when a LODSCO file is not the documented Battle Squadron table."""


def extract(data: bytes) -> list[dict]:
    """Parse Battle Squadron v1.6.1's 12 fixed-size LODSCO records."""
    if len(data) != EXPECTED_SIZE:
        raise InvalidBattleSquadronScoreData(
            f"LODSCO must be exactly {EXPECTED_SIZE} bytes; received {len(data)}"
        )

    rows = []
    for index in range(RECORD_COUNT):
        offset = index * RECORD_SIZE
        match = _ENTRY.fullmatch(data[offset + 4:offset + RECORD_SIZE])
        if not match:
            raise InvalidBattleSquadronScoreData(
                f"LODSCO record {index + 1} has an invalid ASCII score entry"
            )
        rank = int(match.group(1))
        if rank != index + 1:
            raise InvalidBattleSquadronScoreData(
                f"LODSCO record {index + 1} contains unexpected rank {rank}"
            )
        name = match.group(2).decode("ascii").strip().upper() or "---"
        rows.append({"rank": rank, "name": name, "score": int(match.group(3))})
    return rows
