from sqlalchemy import Boolean, Column, ForeignKey, Integer, JSON, String, UniqueConstraint
from app.core.database import Base


class SavedGameSource(Base):
    __tablename__ = 'user_game_sources'
    __table_args__ = (UniqueConstraint('user_id', 'system', 'url_hash'),)
    user_id = Column(ForeignKey('users.id'), primary_key=True)
    id = Column(String(64), primary_key=True)
    system = Column(String(32), nullable=False)
    url = Column(String(4096), nullable=False)
    url_hash = Column(String(64), nullable=False)
    games = Column(JSON, nullable=False, default=list)
    game_count = Column(Integer, nullable=False, default=0)
    revision = Column(String(64), nullable=False)
    deleted = Column(Boolean, nullable=False, default=False)
