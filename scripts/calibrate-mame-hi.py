#!/usr/bin/env python3
import argparse
from pathlib import Path


def bcd_bytes(score: int, width: int) -> bytes | None:
    digits = str(score).rjust(width * 2, "0")
    if len(digits) > width * 2:
        return None
    return bytes((int(digits[index]) << 4) | int(digits[index + 1]) for index in range(0, len(digits), 2))


def find_all(data: bytes, needle: bytes) -> list[int]:
    if not needle:
        return []
    offsets: list[int] = []
    start = 0
    while True:
        index = data.find(needle, start)
        if index < 0:
            return offsets
        offsets.append(index)
        start = index + 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Find likely score encodings in a MAME .hi file.")
    parser.add_argument("rom", help="ROM short name, for notes only")
    parser.add_argument("hi_file", type=Path, help="Path to the .hi file")
    parser.add_argument("known_score", type=int, help="Known visible score to locate")
    args = parser.parse_args()

    data = args.hi_file.read_bytes()
    candidates: list[tuple[str, bytes]] = []
    score_text = str(args.known_score)

    candidates.append(("ascii", score_text.encode("ascii")))
    for width in range(1, 5):
        encoded = bcd_bytes(args.known_score, width)
        if encoded is None:
            continue
        candidates.append((f"bcd_be_{width}b", encoded))
        candidates.append((f"bcd_le_{width}b", encoded[::-1]))
    for width in (2, 3, 4):
        candidates.append((f"int_be_{width}b", args.known_score.to_bytes(width, "big", signed=False)))
        candidates.append((f"int_le_{width}b", args.known_score.to_bytes(width, "little", signed=False)))

    print(f"ROM: {args.rom}")
    print(f"File: {args.hi_file}")
    print(f"Size: {len(data)} bytes")
    print(f"Known score: {args.known_score}")
    print()

    found = False
    for label, needle in candidates:
        offsets = find_all(data, needle)
        if not offsets:
            continue
        found = True
        hex_bytes = " ".join(f"{value:02x}" for value in needle)
        offset_text = ", ".join(f"0x{offset:04x} ({offset})" for offset in offsets)
        print(f"{label}: {hex_bytes} at {offset_text}")

    if not found:
        print("No direct encoding match found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
