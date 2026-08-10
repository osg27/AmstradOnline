from pydantic import BaseModel, Field


class AmigaScoreExtractionRequest(BaseModel):
    game_key: str = Field(min_length=1, max_length=64)
    session_id: str = Field(min_length=1, max_length=128)
    source_path: str = Field(min_length=1, max_length=512)
    data: str = Field(min_length=1)
    baseline_data: str = Field(min_length=1)


class AmigaLeaderboardEntry(BaseModel):
    rank: int
    username: str
    score: int
    initials: str | None = None
