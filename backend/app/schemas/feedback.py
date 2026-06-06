from datetime import datetime

from pydantic import BaseModel, Field, field_validator


VALID_CATEGORIES = {"bug", "suggestion"}
VALID_STATUSES = {"unstarted", "in_review", "resolved", "archived"}


class FeedbackCreateRequest(BaseModel):
    category: str = "bug"
    system: str = Field(default="general", max_length=32)
    title: str = Field(min_length=3, max_length=140)
    details: str = Field(min_length=5, max_length=4000)

    @field_validator("category")
    @classmethod
    def validate_category(cls, value):
        normalized = value.lower().strip()
        if normalized not in VALID_CATEGORIES:
            raise ValueError("Category must be bug or suggestion")
        return normalized

    @field_validator("system")
    @classmethod
    def validate_system(cls, value):
        return value.lower().strip() or "general"


class FeedbackStatusRequest(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, value):
        normalized = value.lower().strip()
        if normalized not in VALID_STATUSES:
            raise ValueError("Unsupported status")
        return normalized


class FeedbackCommentCreateRequest(BaseModel):
    details: str = Field(min_length=1, max_length=2000)

    @field_validator("details")
    @classmethod
    def validate_details(cls, value):
        normalized = value.strip()
        if not normalized:
            raise ValueError("Reply cannot be empty")
        return normalized


class FeedbackCommentResponse(BaseModel):
    id: int
    username: str
    details: str
    created_at: datetime


class FeedbackNotificationResponse(BaseModel):
    id: int
    feedback_id: int
    message: str
    is_read: bool
    created_at: datetime


class FeedbackResponse(BaseModel):
    id: int
    username: str
    category: str
    system: str
    title: str
    details: str
    status: str
    created_at: datetime
    comments: list[FeedbackCommentResponse] = Field(default_factory=list)
