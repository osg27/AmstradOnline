from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from app.core.database import Base


class MameLeaderboardGame(Base):
    __tablename__ = "mame_leaderboard_games"

    id = Column(Integer, primary_key=True, index=True)
    rom_name = Column(String(64), unique=True, nullable=False, index=True)
    display_name = Column(String(255), nullable=False)
    leaderboard_supported = Column(Boolean, nullable=False, default=False, server_default="false")
    score_source = Column(String(16), nullable=False, default="unsupported", server_default="unsupported")
    parser = Column(String(32), nullable=False, default="unsupported", server_default="unsupported")
    enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MameHighScore(Base):
    __tablename__ = "mame_high_scores"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "rom_name",
            name="uq_mame_high_score_user_rom",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    rom_name = Column(String(64), nullable=False, index=True)
    score = Column(Integer, nullable=False, index=True)
    initials = Column(String(16), nullable=True)
    rank_in_game = Column(Integer, nullable=True)
    session_id = Column(String(128), nullable=False, index=True)
    source_path = Column(String(512), nullable=True)
    parser = Column(String(32), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
