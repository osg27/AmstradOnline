from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.core.database import Base


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    room_code = Column(String(16), unique=True, nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(32), nullable=False, default="waiting")
    system = Column(String(32), nullable=False, default="cpc", server_default="cpc")
    party_max_players = Column(Integer, nullable=False, default=2, server_default="2")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
