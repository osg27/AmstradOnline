"""Player RA sessions: bounded HTTPS transport and user-bound encrypted tokens."""
import base64
import json
import threading
import time
from collections import defaultdict, deque
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import HTTPException

from app.core.config import settings
from app.services.retroachievements import NoRedirects

RPC_URL = 'https://retroachievements.org/dorequest.php'
_requests = defaultdict(deque)
_lock = threading.Lock()
_slots = threading.BoundedSemaphore(4)


def limit_request(user_id, action):
    now = time.monotonic()
    with _lock:
        for key in list(_requests):
            while _requests[key] and _requests[key][0][0] < now - 60:
                _requests[key].popleft()
            if not _requests[key]:
                del _requests[key]
        recent = _requests[user_id]
        if len(recent) >= 120 or (action == 'login2' and sum(item[1] == 'login2' for item in recent) >= 6):
            raise HTTPException(429, 'Please wait before making another achievements request.')
        recent.append((now, action))


def forward_rpc(post_data, *, user_agent='OldStyleGaming/0.1 rcheevos/12.5'):
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, 'Achievement connections are busy. Please try again shortly.')
    try:
        request = Request(RPC_URL, data=post_data.encode('utf-8'), headers={
            'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json',
            'User-Agent': user_agent,
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
        if not isinstance(json.loads(body), dict):
            raise ValueError('Invalid response')
        return {'status': status, 'body': body}
    except (URLError, OSError, ValueError):
        raise HTTPException(502, 'The achievements service could not be reached. Please try again.') from None
    finally:
        _slots.release()


def _cipher(user_id):
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None,
               info=f'oldstylegaming/retroachievements/session/v1/{user_id}'.encode()).derive(settings.JWT_SECRET.encode())
    return Fernet(base64.urlsafe_b64encode(key))


def seal_token(user_id, username, token):
    return _cipher(user_id).encrypt(json.dumps({'username': username, 'token': token}).encode()).decode()


def saved_session(user):
    encrypted = getattr(user, 'retroachievements_token', None)
    if not encrypted:
        return None
    try:
        value = json.loads(_cipher(user.id).decrypt(encrypted.encode()))
        if not isinstance(value.get('username'), str) or not isinstance(value.get('token'), str):
            return None
        if not value['username'] or not value['token']:
            return None
        return value
    except (InvalidToken, ValueError, TypeError, AttributeError):
        return None
