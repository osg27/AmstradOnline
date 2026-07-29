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
            "Backend dependencies are not available. Run with the backend venv Python."
        )


ensure_backend_python()
sys.path.insert(0, str(BACKEND))

from sqlalchemy import func  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.mame_leaderboard import MameHighScore  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.mame_high_scores import canonical_mame_rom_name  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete one user's MAME leaderboard score.")
    parser.add_argument("--username", required=True, help="Site username, case-insensitive")
    parser.add_argument("--rom", required=True, help="MAME ROM name, e.g. fshark")
    args = parser.parse_args()

    rom_name = canonical_mame_rom_name(args.rom)
    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(func.lower(User.username) == args.username.lower())
            .first()
        )
        if not user:
            raise SystemExit(f"User not found: {args.username}")

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
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
