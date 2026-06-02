from datetime import datetime

from pydantic import BaseModel, Field, field_validator


VALID_CATEGORIES = {"bug", "suggestion"}
VALID_STATUSES = {"open", "reviewing", "done"}


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


class FeedbackResponse(BaseModel):
    id: int
    username: str
    category: str
    system: str
    title: str
    details: str
    status: str
    created_at: datetime
