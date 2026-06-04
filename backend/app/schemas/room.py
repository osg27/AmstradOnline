from pydantic import BaseModel, Field, field_validator


VALID_SYSTEMS = {"cpc", "cpc_party", "spectrum", "amiga", "amiga_aga", "megadrive", "snes", "arcade"}


class RoomCreateRequest(BaseModel):
    system: str = "cpc"
    party_max_players: int = Field(default=2, ge=2, le=8)

    @field_validator("system")
    @classmethod
    def validate_system(cls, value):
        normalized = value.lower().strip()
        if normalized not in VALID_SYSTEMS:
            raise ValueError("Unsupported system")
        return normalized


class RoomCreateResponse(BaseModel):
    room_code: str
    status: str
    system: str
    party_max_players: int


class RoomJoinRequest(BaseModel):
    room_code: str


class RoomResponse(BaseModel):
    room_code: str
    status: str
    owner_user_id: int
    system: str
    party_max_players: int
