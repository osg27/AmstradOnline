"""Authenticated transport for the official softcore rc_client runtime.

Player passwords/tokens are forwarded over HTTPS, never stored or logged.
The site's read-only Web API key is not involved.
"""
import json
import threading
import time
from collections import defaultdict, deque
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl
from urllib.request import Request, build_opener

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.database import get_db
from app.core.solo_room_abuse import require_open_solo_room
from app.models.room import Room
from app.models.user import User
from app.services.retroachievements import NoRedirects

router = APIRouter(prefix='/auth/retroachievements/play', tags=['retroachievements'])
RPC_URL = 'https://retroachievements.org/dorequest.php'
ALLOWED_ACTIONS = {'login2', 'gameid', 'patch', 'achievementsets', 'unlocks', 'startsession', 'ping', 'awardachievement'}
_requests = defaultdict(deque)
_lock = threading.Lock()
_slots = threading.BoundedSemaphore(4)


class ClientRequest(BaseModel):
    room_code: str = Field(max_length=16)
    post_data: str = Field(max_length=16384, repr=False)


@router.get('/options')
def options(user: User = Depends(get_current_user)):
    return {'username': user.retroachievements_username or '', 'softcore': True}


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


@router.post('/request')
def client_request(payload: ClientRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.room_code == payload.room_code.upper()).first()
    if not room or room.owner_user_id != user.id or room.system != 'megadrive' or room.hosting_mode != 'solo':
        raise HTTPException(403, 'Achievement earning is available only to the host in solo Mega Drive rooms.')
    require_open_solo_room(db, room)
    action = validate_rpc(payload.post_data)
    now = time.monotonic()
    with _lock:
        for key in list(_requests):
            while _requests[key] and _requests[key][0][0] < now - 60:
                _requests[key].popleft()
            if not _requests[key]:
                del _requests[key]
        recent = _requests[user.id]
        if len(recent) >= 120 or (action == 'login2' and sum(item[1] == 'login2' for item in recent) >= 6):
            raise HTTPException(429, 'Please wait before making another achievements request.')
        recent.append((now, action))
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, 'Achievement connections are busy. Please try again shortly.')
    try:
        request = Request(RPC_URL, data=payload.post_data.encode('utf-8'), headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'OldStyleGaming/0.1 rcheevos/12.5',
        })
        try:
            response = build_opener(NoRedirects()).open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read(4 * 1024 * 1024 + 1)
            status = response.status
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError('Oversized response')
        body = raw.decode('utf-8')
        json.loads(body)
        return JSONResponse({'status': status, 'body': body}, headers={'Cache-Control': 'no-store'})
    except (URLError, OSError, ValueError):
        raise HTTPException(502, 'The achievements service could not be reached. Please try again.') from None
    finally:
        _slots.release()
