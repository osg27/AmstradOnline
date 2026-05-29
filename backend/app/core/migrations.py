from sqlalchemy import inspect, text


def ensure_runtime_columns(engine):
    inspector = inspect(engine)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    room_columns = {column["name"] for column in inspector.get_columns("rooms")}

    with engine.begin() as connection:
        dialect = connection.dialect.name
        timestamp_type = "TIMESTAMP WITH TIME ZONE" if dialect == "postgresql" else "DATETIME"

        if "last_login_at" not in user_columns:
            connection.execute(text(f"ALTER TABLE users ADD COLUMN last_login_at {timestamp_type}"))

        if "login_count" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0"))

        if "system" not in room_columns:
            connection.execute(text("ALTER TABLE rooms ADD COLUMN system VARCHAR(32) NOT NULL DEFAULT 'cpc'"))
