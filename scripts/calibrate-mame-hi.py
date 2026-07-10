#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path


def score_variants(score: int) -> list[tuple[str, int]]:
    variants = [("score", score)]
    divisor = 10
    while divisor <= 10000:
        if score % divisor == 0:
            variants.append((f"score_div_{divisor}", score // divisor))
        divisor *= 10
    return variants


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


def ascii_preview(chunk: bytes) -> str:
    return "".join(chr(value) if 32 <= value < 127 else "." for value in chunk)


def print_hexdump(data: bytes, *, limit: int = 256, row_width: int = 16) -> None:
    print()
    print(f"Hex dump, first {min(len(data), limit)} bytes")
    for offset in range(0, min(len(data), limit), row_width):
        chunk = data[offset:offset + row_width]
        hex_text = " ".join(f"{value:02x}" for value in chunk)
        print(f"{offset:04x}: {hex_text:<{row_width * 3}} {ascii_preview(chunk)}")


def parse_candidate_label(label: str, known_score: int) -> dict | None:
    match = re.fullmatch(r"(score(?:_div_(\d+))?)_(ascii|bcd_be|bcd_le|int_be|int_le)(?:_(\d+)b)?", label)
    if not match:
        return None
    divisor = int(match.group(2) or "1")
    return {
        "encoding": match.group(3),
        "score_length": int(match.group(4) or len(str(known_score // divisor))),
        "multiplier": divisor,
    }


def suggest_rules(rom: str, data: bytes, matches: list[tuple[str, bytes, int]]) -> None:
    suggestions: list[dict] = []
    for label, needle, offset in matches:
        parsed = parse_candidate_label(label, 0)
        if not parsed or parsed["encoding"] == "ascii":
            continue
        for row_size in (4, 8, 16):
            for table_start in (0, offset - (offset % row_size)):
                if table_start < 0 or table_start > offset:
                    continue
                score_start = (offset - table_start) % row_size
                if score_start + len(needle) > row_size:
                    continue
                suggestions.append({
                    "rom": rom,
                    "score_offset": table_start,
                    "row_size": row_size,
                    "row_count": max(1, (len(data) - table_start) // row_size),
                    "score_start": score_start,
                    "score_length": len(needle),
                    "encoding": parsed["encoding"],
                    "multiplier": parsed["multiplier"],
                    "max_score": 9999990,
                    "default_scores": []
                })

    if not suggestions:
        return

    print()
    print("Possible JSON rule starters")
    seen: set[str] = set()
    for suggestion in suggestions[:6]:
        key = json.dumps(suggestion, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        rom = suggestion.pop("rom")
        print(json.dumps({rom: suggestion}, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description="Find likely score encodings in a MAME .hi file.")
    parser.add_argument("rom", help="ROM short name, for notes only")
    parser.add_argument("hi_file", type=Path, help="Path to the .hi file")
    parser.add_argument("known_score", type=int, help="Known visible score to locate")
    args = parser.parse_args()

    data = args.hi_file.read_bytes()
    candidates: list[tuple[str, bytes]] = []

    for variant_label, variant_score in score_variants(args.known_score):
        score_text = str(variant_score)
        candidates.append((f"{variant_label}_ascii", score_text.encode("ascii")))
        for width in range(1, 5):
            encoded = bcd_bytes(variant_score, width)
            if encoded is None:
                continue
            candidates.append((f"{variant_label}_bcd_be_{width}b", encoded))
            candidates.append((f"{variant_label}_bcd_le_{width}b", encoded[::-1]))
        for width in (2, 3, 4):
            if variant_score >= 1 << (width * 8):
                continue
            candidates.append((f"{variant_label}_int_be_{width}b", variant_score.to_bytes(width, "big", signed=False)))
            candidates.append((f"{variant_label}_int_le_{width}b", variant_score.to_bytes(width, "little", signed=False)))

    print(f"ROM: {args.rom}")
    print(f"File: {args.hi_file}")
    print(f"Size: {len(data)} bytes")
    print(f"Known score: {args.known_score}")
    print("Searched variants: " + ", ".join(f"{label}={score}" for label, score in score_variants(args.known_score)))
    print()

    found = False
    matches: list[tuple[str, bytes, int]] = []
    for label, needle in candidates:
        offsets = find_all(data, needle)
        if not offsets:
            continue
        found = True
        matches.extend((label, needle, offset) for offset in offsets)
        hex_bytes = " ".join(f"{value:02x}" for value in needle)
        offset_text = ", ".join(f"0x{offset:04x} ({offset})" for offset in offsets)
        print(f"{label}: {hex_bytes} at {offset_text}")

    if not found:
        print("No direct encoding match found.")
    suggest_rules(args.rom, data, matches)
    print_hexdump(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
