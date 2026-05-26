from pydantic import BaseModel


class RoomCreateResponse(BaseModel):
    room_code: str
    status: str


class RoomJoinRequest(BaseModel):
    room_code: str


class RoomResponse(BaseModel):
    room_code: str
    status: str
    owner_user_id: int
