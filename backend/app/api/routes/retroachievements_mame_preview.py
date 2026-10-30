"""Pac-Man experiment: strictly read-only transport; never submits play or awards."""
from hmac import compare_digest
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.routes.auth import get_current_user
from app.models.user import User
from app.services.retroachievements_session import saved_session, forward_rpc, limit_request

router = APIRouter(prefix='/auth/retroachievements/mame-preview', tags=['retroachievements'])
PACMAN_HASH = '64d1f88b9b276aece4b0edcc25b7a434'


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


@router.post('/session')
def preview_session(user: User = Depends(get_current_user)):
    limit_request(user.id, 'mame-preview-session')
    return JSONResponse(connection(user), headers={'Cache-Control': 'no-store'})


@router.post('/request')
def preview_request(payload: PreviewRequest, user: User = Depends(get_current_user)):
    action = validate_preview(payload.post_data, connection(user))
    limit_request(user.id, action)
    return JSONResponse(forward_rpc(payload.post_data), headers={'Cache-Control': 'no-store'})
