from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from app.core.database import Base


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    room_code = Column(String(16), unique=True, nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(32), nullable=False, default="waiting")
    system = Column(String(32), nullable=False, default="cpc", server_default="cpc")
    party_max_players = Column(Integer, nullable=False, default=2, server_default="2")
    arcade_multiplayer = Column(Boolean, nullable=False, default=False, server_default="false")
    current_game = Column(String(512), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RoomActivity(Base):
    __tablename__ = "room_activity"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_activity_user"),)

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=False, index=True)
