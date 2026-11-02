"""Shared, game-bound Arcade experiment transport. Normal Arcade rooms stay separate."""
from dataclasses import dataclass
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


@dataclass(frozen=True)
class ArcadeProfile:
    game_id: str
    game_hash: str
    achievements: frozenset


PACMAN = ArcadeProfile('12192', PACMAN_HASH, PACMAN_ACHIEVEMENTS)
# Verified against the official game/hash APIs on 2026-10-31. World 920513 only.
SF2CE = ArcadeProfile('11772', '48165021fdb6d258a054008f3ee85bdf', frozenset(str(value) for value in [
    277637, 277638, 277639, 277640, 277641, 277642, 277643, 277644, 277645,
    277646, 277647, 277648, 277771, 277772, 277773, 277774, 277775, 277776,
    277777, 277778, 277779, 277780, 277791, 277792, 277793, 277794, 277795,
    277796, 277822, 277823, 277824, 277825, 277826, 277827, 277829,
]))


class PreviewRequest(BaseModel):
    post_data: str = Field(max_length=16384, repr=False)


def connection(user):
    session = saved_session(user)
    if not session:
        raise HTTPException(409, 'Connect RetroAchievements in Profile first.')
    return session


def validate_preview(data, session, profile=PACMAN):
    try:
        pairs = parse_qsl(data, strict_parsing=True, keep_blank_values=True, max_num_fields=16)
    except ValueError:
        raise HTTPException(400, 'Invalid preview request.') from None
    params = dict(pairs)
    allowed = {'login2': {'r', 'u', 't'}, 'achievementsets': {'r', 'u', 't', 'm'}}
    action = params.get('r')
    if len(params) != len(pairs) or action not in allowed or set(params) != allowed[action]:
        raise HTTPException(400, 'This preview only reads achievement definitions. Submissions are disabled.')
    if (params['u'].casefold() != session['username'].casefold()
            or not compare_digest(params['t'].encode(), session['token'].encode())):
        raise HTTPException(403, 'Use your saved Profile connection.')
    if action == 'achievementsets' and params['m'] != profile.game_hash:
        raise HTTPException(400, 'This ROM does not match the selected game.')
    return action


def validate_softcore(data, session, profile=PACMAN):
    try:
        pairs = parse_qsl(data, strict_parsing=True, keep_blank_values=True, max_num_fields=16)
    except ValueError:
        raise HTTPException(400, 'Invalid Arcade experiment request.') from None
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
        raise HTTPException(400, 'Unsupported Arcade experiment request.')
    required, optional = fields[action]
    if not required <= params.keys() or params.keys() - required - optional:
        raise HTTPException(400, 'Invalid Arcade experiment request fields.')
    if (params['u'].casefold() != session['username'].casefold()
            or not compare_digest(params['t'].encode(), session['token'].encode())):
        raise HTTPException(403, 'Use your saved Profile connection.')
    if 'h' in params and params['h'] != '0':
        raise HTTPException(400, 'Arcade experiments support softcore only.')
    if 'g' in params and params['g'] != profile.game_id:
        raise HTTPException(400, 'This request does not match the selected game.')
    hash_field = 'x' if action == 'ping' else 'm'
    if action != 'login2' and params[hash_field] != profile.game_hash:
        raise HTTPException(400, 'This ROM does not match the selected game.')
    if action == 'awardachievement':
        if params['a'] not in profile.achievements or not re.fullmatch('[0-9a-f]{32}', params['v']):
            raise HTTPException(400, 'Unsupported achievement for the selected game.')
        if 'o' in params and not re.fullmatch('[1-9][0-9]{0,7}', params['o']):
            raise HTTPException(400, 'Invalid unlock age.')
    if action == 'startsession' and not re.fullmatch('[0-9.]{1,32}', params['l']):
        raise HTTPException(400, 'Invalid runtime version.')
    return action


@router.post('/session')
@router.post('/softcore/session')
@router.post('/sf2ce/session')
@router.post('/sf2ce/softcore/session')
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


@router.post('/sf2ce/request')
def sf2ce_preview_request(payload: PreviewRequest, user: User = Depends(get_current_user)):
    action = validate_preview(payload.post_data, connection(user), SF2CE)
    limit_request(user.id, action)
    return JSONResponse(forward_rpc(payload.post_data), headers={'Cache-Control': 'no-store'})


@router.post('/sf2ce/softcore/request')
def sf2ce_softcore_request(payload: PreviewRequest, user: User = Depends(get_current_user)):
    action = validate_softcore(payload.post_data, connection(user), SF2CE)
    limit_request(user.id, action)
    return JSONResponse(forward_rpc(payload.post_data, user_agent=PACMAN_USER_AGENT), headers={'Cache-Control': 'no-store'})
