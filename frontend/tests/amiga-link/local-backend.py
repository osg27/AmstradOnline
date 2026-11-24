"""Run the real backend locally on SQLite with two pre-verified tester accounts.

Test-only: never points at production data, and SMTP is aimed at a closed port
so no email can be sent. Writes tokens.json (JWTs for LinkTestA / LinkTestB)
next to the database, then serves on 127.0.0.1:8000 for a Vite dev server on :4173.
Usage: backend/.venv/Scripts/python.exe local-backend.py <work-dir>
"""
import json, os, pathlib, secrets, sys
work = pathlib.Path(sys.argv[1]).resolve(); work.mkdir(parents=True, exist_ok=True)
os.environ.update({
    "DATABASE_URL": f"sqlite:///{(work / 'link-test.db').as_posix()}",
    "JWT_SECRET": secrets.token_hex(32),
    "TESTER_USERNAMES": "LinkTestA,LinkTestB",
    "CORS_ORIGINS": "http://127.0.0.1:4173,http://localhost:4173",
    "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "1",
    "ADMIN_USERNAME": "", "RETROACHIEVEMENTS_API_KEY": "",
})
backend = pathlib.Path(__file__).resolve().parents[3] / "backend"
os.chdir(backend); sys.path.insert(0, str(backend))
from app.main import app  # noqa: E402  (creates tables)
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.models.user import User  # noqa: E402
tokens = {}
with SessionLocal() as db:
    for name in ("LinkTestA", "LinkTestB"):
        user = db.query(User).filter(User.username == name).first()
        if not user:
            user = User(username=name, email=f"{name.lower()}@example.invalid", password_hash=hash_password(secrets.token_hex(8)), email_verified=True, role="tester")
            db.add(user); db.commit(); db.refresh(user)
        user.role = "tester"; user.email_verified = True; db.commit()
        tokens[name] = create_access_token(str(user.id))
(work / "tokens.json").write_text(json.dumps(tokens))
import uvicorn  # noqa: E402
uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
