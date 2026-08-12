from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ScoreSubmit(BaseModel):
    game: str
    system: str
    score: int = Field(ge=0)
    input_replay: Optional[list] = None


class ScoreResponse(BaseModel):
    id: int
    user_id: int
    game: str
    system: str
    score: int
    created_at: datetime

    class Config:
        from_attributes = True


class LeaderboardEntry(BaseModel):
    rank: int
    username: str
    score: int
    created_at: datetime


class RecentScoreEntry(BaseModel):
    username: str
    system: str
    system_name: str
    game_key: str
    game_name: str
    score: int
    created_at: datetime
