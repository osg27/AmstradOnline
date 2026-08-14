import re


EXPECTED_SIZE = 128
RECORD_SIZE = 16
RECORD_COUNT = 8
_ENTRY = re.compile(rb"^(\d)\.(\d{8})(.{6})$")


class InvalidHybrisScoreData(ValueError):
    """Raised when hybrishigh is not the Hybris WHDLoad score table."""


def extract(data: bytes) -> list[dict]:
    """Parse Hybris WHDLoad's eight fixed-width hybrishigh entries."""
    if len(data) != EXPECTED_SIZE:
        raise InvalidHybrisScoreData(
            f"hybrishigh must be exactly {EXPECTED_SIZE} bytes; received {len(data)}"
        )

    rows = []
    for index in range(RECORD_COUNT):
        record = data[index * RECORD_SIZE:(index + 1) * RECORD_SIZE]
        match = _ENTRY.fullmatch(record)
        if not match:
            ascii_preview = "".join(chr(value) if 32 <= value <= 126 else "." for value in record)
            raise InvalidHybrisScoreData(
                f"hybrishigh record {index + 1} is invalid "
                f"(hex={record.hex()}, ascii={ascii_preview!r})"
            )

        rank = int(match.group(1))
        if rank != index + 1:
            raise InvalidHybrisScoreData(
                f"hybrishigh record {index + 1} contains unexpected rank {rank}"
            )
        name = match.group(3).decode("ascii").strip().upper() or "---"
        rows.append({"rank": rank, "name": name, "score": int(match.group(2))})
    return rows
