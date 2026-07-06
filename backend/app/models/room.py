from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func

from app.core.database import Base


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    room_code = Column(String(16), unique=True, nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(32), nullable=False, default="waiting")
    system = Column(String(32), nullable=False, default="cpc", server_default="cpc")
    party_max_players = Column(Integer, nullable=False, default=2, server_default="2")
    current_game = Column(String(512), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RoomActivity(Base):
    __tablename__ = "room_activity"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_activity_user"),)

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=False, index=True)


class RoomScore(Base):
    __tablename__ = "room_scores"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    submitted_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    system = Column(String(32), nullable=False, default="cpc_pinball", server_default="cpc_pinball")
    player_number = Column(Integer, nullable=False)
    player_name = Column(String(80), nullable=False)
    score = Column(Integer, nullable=False)
    screenshot_data_url = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
