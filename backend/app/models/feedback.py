from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func

from app.core.database import Base


class FeedbackItem(Base):
    __tablename__ = "feedback_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String(32), nullable=False, default="bug")
    system = Column(String(32), nullable=False, default="general")
    title = Column(String(140), nullable=False)
    details = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, default="unstarted")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class FeedbackComment(Base):
    __tablename__ = "feedback_comments"

    id = Column(Integer, primary_key=True, index=True)
    feedback_id = Column(Integer, ForeignKey("feedback_items.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    details = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class FeedbackNotification(Base):
    __tablename__ = "feedback_notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    feedback_id = Column(Integer, ForeignKey("feedback_items.id"), nullable=False, index=True)
    message = Column(String(240), nullable=False)
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
