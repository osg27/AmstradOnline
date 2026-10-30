"""Authenticated transport for the official softcore rc_client runtime.

Player credentials are forwarded over HTTPS and never logged. Remembered RA
session tokens are encrypted in Profile; passwords are never stored.
The site's read-only Web API key is not involved.
"""
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.database import get_db
from app.core.solo_room_abuse import require_open_solo_room
from app.models.room import Room
from app.models.user import User
from app.services.retroachievements_session import RPC_URL, forward_rpc, limit_request, saved_session

router = APIRouter(prefix='/auth/retroachievements/play', tags=['retroachievements'])
ALLOWED_ACTIONS = {'login2', 'gameid', 'patch', 'achievementsets', 'unlocks', 'startsession', 'ping', 'awardachievement'}

class ClientRequest(BaseModel):
    room_code: str = Field(max_length=16)
    post_data: str = Field(max_length=16384, repr=False)


@router.get('/options')
def options(user: User = Depends(get_current_user)):
    session = saved_session(user)
    return {'username': session['username'] if session else user.retroachievements_username or '', 'connected': bool(session), 'softcore': True}


def validate_rpc(data):
    try:
        pairs = parse_qsl(data, strict_parsing=True, max_num_fields=32, keep_blank_values=True)
    except ValueError:
        raise HTTPException(400, 'Invalid achievements request.') from None
    params = dict(pairs)
    if len(params) != len(pairs) or params.get('r') not in ALLOWED_ACTIONS:
        raise HTTPException(400, 'Unsupported achievements request.')
    if params.get('h', '0') != '0':
        raise HTTPException(400, 'Only softcore achievements are supported here.')
    return params['r']


def require_room(room_code, user, db):
    room = db.query(Room).filter(Room.room_code == room_code.upper()).first()
    if not room or room.owner_user_id != user.id or room.system not in {'megadrive', 'cpc'} or room.hosting_mode != 'solo':
        raise HTTPException(403, 'Achievement earning is available only to the host in solo Mega Drive and Amstrad CPC rooms.')
    require_open_solo_room(db, room)


@router.post('/request')
def client_request(payload: ClientRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_room(payload.room_code, user, db)
    action = validate_rpc(payload.post_data)
    limit_request(user.id, action)
    return JSONResponse(forward_rpc(payload.post_data), headers={'Cache-Control': 'no-store'})


class RoomSessionRequest(BaseModel):
    room_code: str = Field(max_length=16)


@router.post('/session')
def room_session(payload: RoomSessionRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_room(payload.room_code, user, db)
    session = saved_session(user)
    if not session:
        raise HTTPException(409, 'Connect RetroAchievements in Profile to enable automatic sign-in.')
    return JSONResponse(session, headers={'Cache-Control': 'no-store'})
