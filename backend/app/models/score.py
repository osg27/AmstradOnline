from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func, JSON

from app.core.database import Base


class Score(Base):
    __tablename__ = "scores"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    game = Column(String(255), nullable=False, index=True)
    system = Column(String(32), nullable=False, index=True)
    score = Column(Integer, nullable=False, index=True)
    input_replay = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
