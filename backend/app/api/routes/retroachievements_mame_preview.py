"""Isolated Pac-Man experiment: read-only preview and explicit softcore transport."""
from hmac import compare_digest
import re
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.routes.auth import get_current_user
from app.models.user import User
from app.services.retroachievements_session import saved_session, forward_rpc, limit_request

router = APIRouter(prefix='/auth/retroachievements/mame-preview', tags=['retroachievements'])
PACMAN_HASH = '64d1f88b9b276aece4b0edcc25b7a434'
# Verified against API_GetGameExtended game 12192 on 2026-10-30.
# Only these 21 core achievements; warning/synthetic and other-game IDs denied.
PACMAN_ACHIEVEMENTS = frozenset(str(value) for value in range(127619, 127640))
PACMAN_USER_AGENT = 'OldStyleGaming/v0.2 (Web) mame2003-plus/df60f6466d67 rcheevos/12.5'


class PreviewRequest(BaseModel):
    post_data: str = Field(max_length=16384, repr=False)


def connection(user):
    session = saved_session(user)
    if not session:
        raise HTTPException(409, 'Connect RetroAchievements in Profile first.')
    return session


def validate_preview(data, session):
    try:
        pairs = parse_qsl(data, strict_parsing=True, keep_blank_values=True, max_num_fields=16)
    except ValueError:
        raise HTTPException(400, 'Invalid preview request.') from None
    params = dict(pairs)
    allowed = {'login2': {'r', 'u', 't'}, 'achievementsets': {'r', 'u', 't', 'm'}}
    action = params.get('r')
    if len(params) != len(pairs) or action not in allowed or set(params) != allowed[action]:
        raise HTTPException(400, 'This preview only reads Pac-Man achievement definitions. Submissions are disabled.')
    if (params['u'].casefold() != session['username'].casefold()
            or not compare_digest(params['t'].encode(), session['token'].encode())):
        raise HTTPException(403, 'Use your saved Profile connection.')
    if action == 'achievementsets' and params['m'] != PACMAN_HASH:
        raise HTTPException(400, 'This preview supports pacman.zip only.')
    return action


def validate_softcore(data, session):
    try:
        pairs = parse_qsl(data, strict_parsing=True, keep_blank_values=True, max_num_fields=16)
    except ValueError:
        raise HTTPException(400, 'Invalid Pac-Man request.') from None
    params = dict(pairs)
    fields = {
        'login2': ({'r', 'u', 't'}, set()),
        'achievementsets': ({'r', 'u', 't', 'm'}, set()),
        'startsession': ({'r', 'u', 't', 'g', 'h', 'm', 'l'}, set()),
        'ping': ({'r', 'u', 't', 'g', 'h', 'x'}, {'m'}),
        'awardachievement': ({'r', 'u', 't', 'a', 'h', 'm', 'v'}, {'o'}),
    }
    action = params.get('r')
    if len(params) != len(pairs) or action not in fields:
        raise HTTPException(400, 'Unsupported Pac-Man request.')
    required, optional = fields[action]
    if not required <= params.keys() or params.keys() - required - optional:
        raise HTTPException(400, 'Invalid Pac-Man request fields.')
    if (params['u'].casefold() != session['username'].casefold()
            or not compare_digest(params['t'].encode(), session['token'].encode())):
        raise HTTPException(403, 'Use your saved Profile connection.')
    if 'h' in params and params['h'] != '0':
        raise HTTPException(400, 'Pac-Man supports softcore only.')
    if 'g' in params and params['g'] != '12192':
        raise HTTPException(400, 'Only Pac-Man is enabled.')
    hash_field = 'x' if action == 'ping' else 'm'
    if action != 'login2' and params[hash_field] != PACMAN_HASH:
        raise HTTPException(400, 'Only pacman.zip is enabled.')
    if action == 'awardachievement':
        if params['a'] not in PACMAN_ACHIEVEMENTS or not re.fullmatch('[0-9a-f]{32}', params['v']):
            raise HTTPException(400, 'Unsupported Pac-Man achievement.')
        if 'o' in params and not re.fullmatch('[1-9][0-9]{0,7}', params['o']):
            raise HTTPException(400, 'Invalid unlock age.')
    if action == 'startsession' and not re.fullmatch('[0-9.]{1,32}', params['l']):
        raise HTTPException(400, 'Invalid runtime version.')
    return action


@router.post('/session')
@router.post('/softcore/session')
def preview_session(user: User = Depends(get_current_user)):
    limit_request(user.id, 'mame-preview-session')
    return JSONResponse(connection(user), headers={'Cache-Control': 'no-store'})


@router.post('/request')
def preview_request(payload: PreviewRequest, user: User = Depends(get_current_user)):
    action = validate_preview(payload.post_data, connection(user))
    limit_request(user.id, action)
    return JSONResponse(forward_rpc(payload.post_data), headers={'Cache-Control': 'no-store'})


@router.post('/softcore/request')
def softcore_request(payload: PreviewRequest, user: User = Depends(get_current_user)):
    action = validate_softcore(payload.post_data, connection(user))
    limit_request(user.id, action)
    return JSONResponse(forward_rpc(payload.post_data, user_agent=PACMAN_USER_AGENT), headers={'Cache-Control': 'no-store'})
