from sqlalchemy import Boolean, Column, DateTime, Integer, String
from app.core.database import Base


class PlaySession(Base):
    __tablename__ = 'play_sessions'
    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, nullable=False, index=True)
    room_code = Column(String(16), nullable=False)
    user_id = Column(Integer, nullable=False, index=True)
    username = Column(String(255), nullable=False)
    host_id = Column(Integer, nullable=False, index=True)
    host_name = Column(String(255), nullable=False)
    system = Column(String(32), nullable=False)
    game = Column(String(512), nullable=True)
    mode = Column(String(16), nullable=False)
    is_host = Column(Boolean, nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=False, index=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    end_reason = Column(String(32), nullable=True)
    peer_connected = Column(Boolean, nullable=False, default=False)
    ever_connected = Column(Boolean, nullable=False, default=False)
    connected_seconds = Column(Integer, nullable=False, default=0)
    duration_seconds = Column(Integer, nullable=False, default=0)
