from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.routes.auth import can_use_preview_systems, get_current_user, is_admin_user
from app.core.database import get_db
from app.core.config import settings
from app.models.feedback import FeedbackComment, FeedbackItem, FeedbackNotification
from app.models.user import User
from app.schemas.feedback import (
    FeedbackCommentCreateRequest,
    FeedbackCommentResponse,
    FeedbackCreateRequest,
    FeedbackNotificationResponse,
    FeedbackResponse,
    FeedbackStatusRequest,
)

router = APIRouter(prefix="/auth/feedback", tags=["feedback"])


def require_tester(user: User = Depends(get_current_user)) -> User:
    if not can_use_preview_systems(user):
        raise HTTPException(status_code=403, detail="Tester access required")

    return user


def serialize_comment(comment: FeedbackComment, username: str) -> FeedbackCommentResponse:
    return FeedbackCommentResponse(
        id=comment.id,
        username=username,
        details=comment.details,
        created_at=comment.created_at,
    )


def serialize_feedback(
    item: FeedbackItem,
    username: str,
    comments: list[FeedbackCommentResponse] | None = None,
) -> FeedbackResponse:
    return FeedbackResponse(
        id=item.id,
        username=username,
        category=item.category,
        system=item.system,
        title=item.title,
        details=item.details,
        status=item.status,
        created_at=item.created_at,
        comments=comments or [],
    )


def get_feedback_comments(db: Session, feedback_ids: list[int]) -> dict[int, list[FeedbackCommentResponse]]:
    comments_by_feedback = {feedback_id: [] for feedback_id in feedback_ids}
    if not feedback_ids:
        return comments_by_feedback

    rows = (
        db.query(FeedbackComment, User.username)
        .join(User, User.id == FeedbackComment.user_id)
        .filter(FeedbackComment.feedback_id.in_(feedback_ids))
        .order_by(FeedbackComment.created_at.asc(), FeedbackComment.id.asc())
        .all()
    )
    for comment, username in rows:
        comments_by_feedback[comment.feedback_id].append(serialize_comment(comment, username))
    return comments_by_feedback


def add_notification(db: Session, recipient_id: int, feedback_id: int, message: str, actor_id: int) -> None:
    if recipient_id != actor_id:
        db.add(FeedbackNotification(user_id=recipient_id, feedback_id=feedback_id, message=message))


def get_admin_user(db: Session) -> User | None:
    if not settings.ADMIN_USERNAME:
        return None
    return db.query(User).filter(func.lower(User.username) == settings.ADMIN_USERNAME.lower()).first()


@router.get("", response_model=list[FeedbackResponse])
def list_feedback(
    db: Session = Depends(get_db),
    user: User = Depends(require_tester),
):
    rows = (
        db.query(FeedbackItem, User.username)
        .join(User, User.id == FeedbackItem.user_id)
        .order_by(FeedbackItem.created_at.desc(), FeedbackItem.id.desc())
        .limit(100)
        .all()
    )

    comments = get_feedback_comments(db, [item.id for item, _ in rows])
    return [serialize_feedback(item, username, comments[item.id]) for item, username in rows]


@router.post("", response_model=FeedbackResponse)
def create_feedback(
    payload: FeedbackCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_tester),
):
    item = FeedbackItem(
        user_id=user.id,
        category=payload.category,
        system=payload.system,
        title=payload.title.strip(),
        details=payload.details.strip(),
    )
    db.add(item)
    db.flush()
    admin = get_admin_user(db)
    if admin:
        add_notification(db, admin.id, item.id, f"{user.username} added {item.category}: {item.title}", user.id)
    db.commit()
    db.refresh(item)

    return serialize_feedback(item, user.username)


@router.patch("/{feedback_id}/status", response_model=FeedbackResponse)
def update_feedback_status(
    feedback_id: int,
    payload: FeedbackStatusRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_tester),
):
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")

    row = (
        db.query(FeedbackItem, User.username)
        .join(User, User.id == FeedbackItem.user_id)
        .filter(FeedbackItem.id == feedback_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")

    item, username = row
    item.status = payload.status
    add_notification(
        db,
        item.user_id,
        item.id,
        f"{user.username} changed your feedback status to {payload.status.replace('_', ' ')}: {item.title}",
        user.id,
    )
    db.commit()
    db.refresh(item)

    return serialize_feedback(item, username)


@router.post("/{feedback_id}/comments", response_model=FeedbackCommentResponse)
def create_feedback_comment(
    feedback_id: int,
    payload: FeedbackCommentCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_tester),
):
    item = db.query(FeedbackItem).filter(FeedbackItem.id == feedback_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Feedback not found")

    comment = FeedbackComment(feedback_id=feedback_id, user_id=user.id, details=payload.details.strip())
    db.add(comment)
    add_notification(db, item.user_id, item.id, f"{user.username} replied to your feedback: {item.title}", user.id)
    admin = get_admin_user(db)
    if admin and admin.id != item.user_id:
        add_notification(db, admin.id, item.id, f"{user.username} replied to feedback: {item.title}", user.id)
    db.commit()
    db.refresh(comment)
    return serialize_comment(comment, user.username)


@router.delete("/{feedback_id}", status_code=204)
def delete_feedback(
    feedback_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tester),
):
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")

    item = db.query(FeedbackItem).filter(FeedbackItem.id == feedback_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Feedback not found")

    db.query(FeedbackComment).filter(FeedbackComment.feedback_id == feedback_id).delete()
    db.query(FeedbackNotification).filter(FeedbackNotification.feedback_id == feedback_id).delete()
    db.delete(item)
    db.commit()


@router.get("/notifications", response_model=list[FeedbackNotificationResponse])
def list_feedback_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(require_tester),
):
    return (
        db.query(FeedbackNotification)
        .filter(FeedbackNotification.user_id == user.id)
        .order_by(FeedbackNotification.created_at.desc(), FeedbackNotification.id.desc())
        .limit(50)
        .all()
    )


@router.patch("/notifications/read", status_code=204)
def mark_feedback_notifications_read(
    db: Session = Depends(get_db),
    user: User = Depends(require_tester),
):
    (
        db.query(FeedbackNotification)
        .filter(FeedbackNotification.user_id == user.id, FeedbackNotification.is_read.is_(False))
        .update({FeedbackNotification.is_read: True}, synchronize_session=False)
    )
    db.commit()
