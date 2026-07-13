#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path


RULES_PATH = Path(__file__).resolve().parents[1] / "backend" / "app" / "data" / "mame_hi_rules.json"


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


def decode_bcd_score(chunk: bytes) -> int | None:
    digits: list[str] = []
    for value in chunk:
        high = value >> 4
        low = value & 0x0f
        if high > 9 or low > 9:
            return None
        digits.extend((str(high), str(low)))
    return int("".join(digits))


def decode_rule_score(chunk: bytes, encoding: str) -> int | None:
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
    return None


def normalise_rom(value: str) -> str:
    return re.sub(r"[^a-z0-9_+-]", "", value.lower().replace(".zip", "").replace(".7z", ""))


def load_configured_rule(rom: str) -> dict | None:
    try:
        rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return rules.get(normalise_rom(rom))


def print_configured_decode(rom: str, data: bytes) -> None:
    rule = load_configured_rule(rom)
    if not rule:
        return

    score_offset = int(rule.get("score_offset", 0))
    row_size = int(rule["row_size"])
    row_count = int(rule.get("row_count") or 0)
    score_start = int(rule.get("score_start", 0))
    score_length = int(rule["score_length"])
    multiplier = int(rule.get("multiplier", 1))
    encoding = str(rule.get("encoding", "bcd_be"))
    defaults = {int(score) for score in rule.get("default_scores", [])}
    display_name = str(rule.get("display_name") or rom)

    print()
    print(f"Configured parser decode for {display_name}")
    print(
        f"offset={score_offset}, row_size={row_size}, rows={row_count}, "
        f"score_start={score_start}, score_length={score_length}, encoding={encoding}, multiplier={multiplier}"
    )

    table = data[score_offset:]
    if row_count > 0:
        table = table[:row_count * row_size]

    found = False
    for index in range(0, len(table) - (len(table) % row_size), row_size):
        row = table[index:index + row_size]
        raw = decode_rule_score(row[score_start:score_start + score_length], encoding)
        if raw is None:
            continue
        score = raw * multiplier
        marker = "default" if score in defaults else "player?"
        print(f"row {(index // row_size) + 1}: score={score} {marker} bytes={' '.join(f'{value:02x}' for value in row)}")
        found = True

    if not found:
        print("Configured parser did not decode any rows.")

    if normalise_rom(rom) == "robotron":
        print()
        print("Robotron all-time table decode")
        all_time_offset = 0x160
        row_size = 14
        found_all_time = False
        for row_index in range(37):
            start = all_time_offset + (row_index * row_size)
            row = data[start:start + row_size]
            if len(row) < row_size:
                break
            score = decode_bcd_score(row[3:6])
            if score is None:
                continue
            marker = "default" if score == 10000 else "player?"
            print(f"row {row_index + 1}: score={score} {marker} bytes={' '.join(f'{value:02x}' for value in row)}")
            found_all_time = True

        if not found_all_time:
            print("Robotron all-time table did not decode any rows.")


def digit_sequences(score: int) -> list[tuple[str, str]]:
    plain = str(score)
    sequences = [("digits", plain)]
    for width in range(len(plain) + 1, 9):
        sequences.append((f"digits_zpad_{width}", plain.rjust(width, "0")))
    return sequences


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


def nibble_digit(value: int, mode: str) -> int | None:
    if mode == "byte_digit":
        return value if 0 <= value <= 9 else None
    if mode == "low_nibble":
        digit = value & 0x0f
    elif mode == "high_nibble":
        digit = value >> 4
    elif mode == "low_nibble_xor_ff":
        digit = (value ^ 0xff) & 0x0f
    elif mode == "high_nibble_xor_ff":
        digit = (value ^ 0xff) >> 4
    elif mode == "low_nibble_xor_0f":
        digit = (value ^ 0x0f) & 0x0f
    elif mode == "high_nibble_xor_f0":
        digit = (value ^ 0xf0) >> 4
    elif mode == "low_nibble_9s_comp":
        digit = 9 - (value & 0x0f)
    elif mode == "high_nibble_9s_comp":
        digit = 9 - (value >> 4)
    else:
        return None
    return digit if 0 <= digit <= 9 else None


def find_digit_stream_matches(data: bytes, score: int) -> list[tuple[str, list[int], str]]:
    modes = (
        "byte_digit",
        "low_nibble",
        "high_nibble",
        "low_nibble_xor_ff",
        "high_nibble_xor_ff",
        "low_nibble_xor_0f",
        "high_nibble_xor_f0",
        "low_nibble_9s_comp",
        "high_nibble_9s_comp",
    )
    matches: list[tuple[str, list[int], str]] = []
    seen: set[tuple[str, tuple[int, ...], str]] = set()
    for sequence_label, digits_text in digit_sequences(score):
        target = [int(char) for char in digits_text]
        for mode in modes:
            for stride in range(1, 5):
                max_start = len(data) - ((len(target) - 1) * stride)
                for start in range(max(0, max_start)):
                    offsets = [start + index * stride for index in range(len(target))]
                    decoded = [nibble_digit(data[offset], mode) for offset in offsets]
                    if decoded != target:
                        continue
                    key = (mode, tuple(offsets), sequence_label)
                    if key in seen:
                        continue
                    seen.add(key)
                    matches.append((mode, offsets, sequence_label))
    return matches


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

    print_configured_decode(args.rom, data)

    digit_matches = find_digit_stream_matches(data, args.known_score)
    if digit_matches:
        print()
        print("Digit/nibble stream matches")
        for mode, offsets, sequence_label in digit_matches[:40]:
            values = " ".join(f"{data[offset]:02x}" for offset in offsets)
            offset_text = ", ".join(f"0x{offset:04x}" for offset in offsets)
            print(f"{sequence_label}_{mode}: bytes {values} at {offset_text}")
        if len(digit_matches) > 40:
            print(f"... {len(digit_matches) - 40} more digit/nibble matches omitted")
    else:
        print("No digit/nibble stream match found.")

    suggest_rules(args.rom, data, matches)
    print_hexdump(data, limit=min(len(data), 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
