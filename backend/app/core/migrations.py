from sqlalchemy import inspect, text

from app.core.config import settings


def ensure_runtime_columns(engine):
    inspector = inspect(engine)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    room_columns = {column["name"] for column in inspector.get_columns("rooms")}
    table_names = set(inspector.get_table_names())

    with engine.begin() as connection:
        dialect = connection.dialect.name
        timestamp_type = "TIMESTAMP WITH TIME ZONE" if dialect == "postgresql" else "DATETIME"

        if "last_login_at" not in user_columns:
            connection.execute(text(f"ALTER TABLE users ADD COLUMN last_login_at {timestamp_type}"))

        if "login_count" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0"))

        if "email_verified" not in user_columns:
            verified_default = "TRUE" if dialect == "postgresql" else "1"
            connection.execute(
                text(f"ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT {verified_default}")
            )

        if "role" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'"))
            if settings.ADMIN_USERNAME:
                connection.execute(
                    text("UPDATE users SET role = 'admin' WHERE LOWER(username) = LOWER(:username)"),
                    {"username": settings.ADMIN_USERNAME},
                )
            for username in settings.TESTER_USERNAMES:
                connection.execute(
                    text(
                        "UPDATE users SET role = 'tester' "
                        "WHERE LOWER(username) = LOWER(:username) AND role = 'user'"
                    ),
                    {"username": username},
                )

        connection.execute(
            text("UPDATE users SET role = 'admin' WHERE LOWER(username) = LOWER(:username)"),
            {"username": settings.SUPER_ADMIN_USERNAME},
        )

        if "last_seen_at" not in user_columns:
            connection.execute(text(f"ALTER TABLE users ADD COLUMN last_seen_at {timestamp_type}"))

        if "system" not in room_columns:
            connection.execute(text("ALTER TABLE rooms ADD COLUMN system VARCHAR(32) NOT NULL DEFAULT 'cpc'"))

        if "party_max_players" not in room_columns:
            connection.execute(text("ALTER TABLE rooms ADD COLUMN party_max_players INTEGER NOT NULL DEFAULT 2"))

        if "feedback_items" in table_names:
            connection.execute(text("UPDATE feedback_items SET status = 'unstarted' WHERE status = 'open'"))
            connection.execute(text("UPDATE feedback_items SET status = 'in_review' WHERE status = 'reviewing'"))
            connection.execute(text("UPDATE feedback_items SET status = 'resolved' WHERE status = 'done'"))
