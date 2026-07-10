#!/usr/bin/env python3
import argparse
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
    print_hexdump(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
