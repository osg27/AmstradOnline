from pydantic import BaseModel, Field, field_validator


VALID_SYSTEMS = {"cpc", "cpc_party", "spectrum", "c64", "atari8", "atarist", "x68000", "amiga", "amiga_link", "amiga_aga", "mastersystem", "megadrive", "saturn", "saturn_beetle", "nes", "snes", "pcengine", "playstation", "arcade"}


class RoomCreateRequest(BaseModel):
    system: str = "cpc"
    hosting_mode: str = "multiplayer"
    party_max_players: int = Field(default=2, ge=2, le=20)
    arcade_multiplayer: bool = False
    is_private: bool = False
    password: str | None = Field(default=None, min_length=4, max_length=100)

    @field_validator("system")
    @classmethod
    def validate_system(cls, value):
        normalized = value.lower().strip()
        if normalized not in VALID_SYSTEMS:
            raise ValueError("Unsupported system")
        return normalized

    @field_validator("hosting_mode")
    @classmethod
    def validate_hosting_mode(cls, value):
        if value not in {"solo", "multiplayer"}:
            raise ValueError("Unsupported hosting mode")
        return value


class RoomUpdateRequest(BaseModel):
    system: str
    party_max_players: int = Field(default=2, ge=2, le=20)
    arcade_multiplayer: bool = False

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
    hosting_mode: str
    party_max_players: int
    arcade_multiplayer: bool
    is_private: bool = False
    has_password: bool = False


class ArcadeModeUpdateRequest(BaseModel):
    multiplayer: bool


class RoomJoinRequest(BaseModel):
    room_code: str
    password: str | None = Field(default=None, max_length=100)


class RoomHeartbeatRequest(BaseModel):
    game_name: str | None = Field(default=None, max_length=512)


class RoomResponse(BaseModel):
    room_code: str
    status: str
    owner_user_id: int
    system: str
    hosting_mode: str
    party_max_players: int
    arcade_multiplayer: bool
    is_private: bool = False
    has_password: bool = False
