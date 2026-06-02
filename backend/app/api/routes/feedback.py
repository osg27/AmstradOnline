from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.auth import can_use_preview_systems, get_current_user, is_admin_user
from app.core.database import get_db
from app.models.feedback import FeedbackItem
from app.models.user import User
from app.schemas.feedback import FeedbackCreateRequest, FeedbackResponse, FeedbackStatusRequest

router = APIRouter(prefix="/auth/feedback", tags=["feedback"])


def require_tester(user: User = Depends(get_current_user)) -> User:
    if not can_use_preview_systems(user):
        raise HTTPException(status_code=403, detail="Tester access required")

    return user


def serialize_feedback(item: FeedbackItem, username: str) -> FeedbackResponse:
    return FeedbackResponse(
        id=item.id,
        username=username,
        category=item.category,
        system=item.system,
        title=item.title,
        details=item.details,
        status=item.status,
        created_at=item.created_at,
    )


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

    return [serialize_feedback(item, username) for item, username in rows]


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
    db.commit()
    db.refresh(item)

    return serialize_feedback(item, username)
