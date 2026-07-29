#!/usr/bin/env python3
import argparse
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
VENV_PYTHON_CANDIDATES = [
    BACKEND / ".venv" / "bin" / "python",
    BACKEND / ".venv" / "Scripts" / "python.exe",
    BACKEND / "venv" / "bin" / "python",
    BACKEND / "venv" / "Scripts" / "python.exe",
    ROOT / "venv" / "bin" / "python",
    ROOT / "venv" / "Scripts" / "python.exe",
]


def ensure_backend_python() -> None:
    try:
        import sqlalchemy  # noqa: F401
    except ModuleNotFoundError:
        for candidate in VENV_PYTHON_CANDIDATES:
            if candidate.is_file() and Path(sys.executable).resolve() != candidate.resolve():
                os.execv(str(candidate), [str(candidate), *sys.argv])
        raise SystemExit(
            "Backend dependencies are not available. Run with the backend venv Python, "
            "for example: /opt/amstrad-multiplayer/backend/.venv/bin/python "
            "scripts/upsert-mame-score.py --username CharlieFar --rom galaxian --score 54020"
        )


ensure_backend_python()
sys.path.insert(0, str(BACKEND))

from sqlalchemy import func  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.mame_leaderboard import MameHighScore, MameLeaderboardGame  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.mame_high_scores import CONFIGURED_HI_PARSER, canonical_mame_rom_name  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Insert, update, or delete a user's MAME leaderboard score.")
    parser.add_argument("--username", required=True, help="Site username, case-insensitive")
    parser.add_argument("--rom", required=True, help="MAME ROM name, e.g. galaxian")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--score", type=int, help="Trusted score to store")
    action.add_argument("--delete", action="store_true", help="Delete this user's score for the ROM")
    parser.add_argument("--initials", default=None, help="Optional arcade initials")
    parser.add_argument("--session-id", default=None, help="Optional session id/audit label")
    parser.add_argument("--parser", default=CONFIGURED_HI_PARSER, help="Parser label to store")
    args = parser.parse_args()

    if args.score is not None and args.score <= 0:
        raise SystemExit("Score must be positive.")

    rom_name = canonical_mame_rom_name(args.rom)
    session_id = (args.session_id or f"manual-repair-{rom_name}")[:128]

    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(func.lower(User.username) == args.username.lower())
            .first()
        )
        if not user:
            raise SystemExit(f"User not found: {args.username}")

        if args.delete:
            deleted = (
                db.query(MameHighScore)
                .filter(
                    MameHighScore.user_id == user.id,
                    MameHighScore.rom_name == rom_name,
                )
                .delete(synchronize_session=False)
            )
            db.commit()
            print(f"deleted {deleted} score(s): {user.username} {rom_name}")
            return 0

        game = db.query(MameLeaderboardGame).filter(MameLeaderboardGame.rom_name == rom_name).first()
        if game:
            game.leaderboard_supported = True
            game.enabled = True
        else:
            db.add(MameLeaderboardGame(
                rom_name=rom_name,
                display_name=rom_name,
                leaderboard_supported=True,
                score_source="hi",
                parser=args.parser,
                enabled=True,
            ))

        existing = (
            db.query(MameHighScore)
            .filter(MameHighScore.user_id == user.id, MameHighScore.rom_name == rom_name)
            .first()
        )
        if existing:
            before = existing.score
            existing.score = max(existing.score, args.score)
            if args.score >= before:
                existing.initials = args.initials or existing.initials
                existing.session_id = session_id
                existing.source_path = "manual"
                existing.parser = args.parser
            action = "updated" if existing.score != before else "kept"
            final_score = existing.score
        else:
            db.add(MameHighScore(
                user_id=user.id,
                rom_name=rom_name,
                score=args.score,
                initials=args.initials,
                rank_in_game=None,
                session_id=session_id,
                source_path="manual",
                parser=args.parser,
            ))
            action = "inserted"
            final_score = args.score

        db.commit()
        print(f"{action}: {user.username} {rom_name} {final_score}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
