#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.services.mame_high_scores import (  # noqa: E402
    HI2TXT_PARSER,
    MameNoPlayerScore,
    ParsedMameScore,
    filter_hi2txt_player_scores,
    parse_hi2txt,
    serialize_parsed_scores,
)


class _Query:
    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def first(self):
        return None


class _Db:
    def query(self, *args, **kwargs):
        return _Query()


class _Game:
    parser = HI2TXT_PARSER

    def __init__(self, rom_name: str, display_name: str | None = None):
        self.rom_name = rom_name
        self.display_name = display_name or rom_name


def print_table(label: str, rows: list[ParsedMameScore]) -> None:
    print()
    print(label)
    if not rows:
        print("  none")
        return
    for row in rows:
        initials = row.initials or "---"
        rank = row.rank_in_game if row.rank_in_game is not None else "-"
        print(f"  rank={rank} initials={initials} score={row.score}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Replay MAME hi2txt baseline/current score extraction without playing a game."
    )
    parser.add_argument("rom", help="MAME ROM name, e.g. ddragon")
    parser.add_argument("baseline_hi", type=Path, help="Start-of-game .hi file")
    parser.add_argument("current_hi", type=Path, help="Current/end-of-run .hi file")
    parser.add_argument("--username", default="OldStyleGaming", help="Username used for initials fallback")
    parser.add_argument("--user-id", type=int, default=1, help="Mock user id")
    args = parser.parse_args()

    baseline = parse_hi2txt(args.baseline_hi, args.rom)
    current = parse_hi2txt(args.current_hi, args.rom)
    game = _Game(args.rom)

    print(f"ROM: {args.rom}")
    print(f"Baseline: {args.baseline_hi} ({args.baseline_hi.stat().st_size} bytes)")
    print(f"Current:  {args.current_hi} ({args.current_hi.stat().st_size} bytes)")
    print_table("Baseline parsed rows", baseline)
    print_table("Current parsed rows", current)

    try:
        filtered = filter_hi2txt_player_scores(
            db=_Db(),
            game=game,
            rom_name=args.rom,
            user_id=args.user_id,
            username=args.username,
            current_scores=current,
            baseline_scores=baseline,
        )
    except MameNoPlayerScore as exc:
        print()
        print(f"NO SCORE: {exc}")
        print(f"Parsed debug: {serialize_parsed_scores(current)}")
        print(f"Baseline debug: {serialize_parsed_scores(baseline)}")
        return 2

    print_table("Would save", filtered.scores)
    print()
    print(f"Expected initials: {', '.join(filtered.expected_initials) or 'none'}")
    print(f"Parsed debug: {serialize_parsed_scores(current)}")
    print(f"Baseline debug: {serialize_parsed_scores(baseline)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
