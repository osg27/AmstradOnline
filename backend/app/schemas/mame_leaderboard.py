from datetime import datetime

from pydantic import BaseModel, Field


class MameSaveFile(BaseModel):
    path: str = Field(min_length=1, max_length=512)
    data: str = Field(min_length=1)


class MameScoreExtractionRequest(BaseModel):
    rom_name: str = Field(min_length=1, max_length=64)
    user_id: int | None = None
    save_files: list[MameSaveFile] = Field(default_factory=list)


class MameScoreExtractionResponse(BaseModel):
    status: str
    session_id: str
    rom_name: str
    parser: str | None = None
    source_path: str | None = None
    saved_paths: list[str] = Field(default_factory=list)
    scores_parsed: int = 0
    rows_inserted: int = 0
    message: str | None = None


class MameLeaderboardGameResponse(BaseModel):
    rom_name: str
    display_name: str
    leaderboard_supported: bool
    score_source: str
    parser: str
    enabled: bool

    class Config:
        from_attributes = True


class MameLeaderboardEntry(BaseModel):
    rank: int
    username: str
    initials: str | None
    score: int
    rank_in_game: int | None
    created_at: datetime
