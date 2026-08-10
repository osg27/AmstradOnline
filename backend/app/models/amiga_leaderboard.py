from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from app.core.database import Base


class AmigaHighScore(Base):
    __tablename__ = "amiga_high_scores"
    __table_args__ = (
        UniqueConstraint("user_id", "game_key", name="uq_amiga_high_score_user_game"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    game_key = Column(String(64), nullable=False, index=True)
    score = Column(Integer, nullable=False, index=True)
    initials = Column(String(16), nullable=True)
    session_id = Column(String(128), nullable=False, index=True)
    source_path = Column(String(512), nullable=True)
    parser = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
