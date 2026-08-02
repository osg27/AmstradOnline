from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from app.core.database import Base


class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(12), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    creator_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    rom_name = Column(String(64), nullable=False, index=True)
    display_name = Column(String(255), nullable=False)
    starts_at = Column(DateTime(timezone=True), nullable=False, index=True)
    ends_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TournamentEntry(Base):
    __tablename__ = "tournament_entries"
    __table_args__ = (UniqueConstraint("tournament_id", "user_id", name="uq_tournament_entry_user"),)

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    joined_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TournamentScore(Base):
    __tablename__ = "tournament_scores"
    __table_args__ = (UniqueConstraint("tournament_id", "user_id", name="uq_tournament_score_user"),)

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    score = Column(Integer, nullable=False, index=True)
    initials = Column(String(16), nullable=True)
    attempts = Column(Integer, nullable=False, default=1, server_default="1")
    session_id = Column(String(128), nullable=False)
    achieved_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
