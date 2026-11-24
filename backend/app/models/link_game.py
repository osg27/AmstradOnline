from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String

from app.core.database import Base


class LinkGame(Base):
    __tablename__ = 'link_games'

    id = Column(String(32), primary_key=True)
    title = Column(String(120), nullable=False)
    file_name = Column(String(240), nullable=False)
    sha256 = Column(String(64), nullable=False)
    size = Column(Integer, nullable=False)
    notes = Column(String(500), nullable=False, default='')
    published = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
