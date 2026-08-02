from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.mame_leaderboard import MameSaveFile


class TournamentCreate(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    rom_name: str = Field(min_length=1, max_length=64)
    duration_hours: int = Field(ge=1, le=24 * 30)
    starts_at: datetime | None = None


class TournamentScoreSubmit(BaseModel):
    rom_name: str = Field(min_length=1, max_length=64)
    save_files: list[MameSaveFile] = Field(default_factory=list)
    baseline_save_files: list[MameSaveFile] = Field(default_factory=list)

