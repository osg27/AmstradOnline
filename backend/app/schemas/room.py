from pydantic import BaseModel, field_validator


VALID_SYSTEMS = {"cpc", "spectrum"}


class RoomCreateRequest(BaseModel):
    system: str = "cpc"

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


class RoomJoinRequest(BaseModel):
    room_code: str


class RoomResponse(BaseModel):
    room_code: str
    status: str
    owner_user_id: int
    system: str
