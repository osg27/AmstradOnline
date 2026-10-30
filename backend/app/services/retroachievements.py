"""Read-only public RetroAchievements profiles; never awards achievements."""
import json
import re
import threading
import time
from collections import OrderedDict, deque
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import HTTPException
from app.core.config import settings

CACHE_SECONDS = 300
_cache = OrderedDict()
_recent_requests = deque()
_lock = threading.Lock()
_slots = threading.BoundedSemaphore(4)


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def configured():
    return bool(settings.RETROACHIEVEMENTS_API_KEY.get_secret_value().strip())


def request_public(endpoint, identifier, **params):
    key = settings.RETROACHIEVEMENTS_API_KEY.get_secret_value().strip()
    if not key:
        raise HTTPException(503, 'RetroAchievements is waiting for the site API key to be configured.')
    cache_key = (endpoint, identifier.lower(), tuple(sorted(params.items())))
    now = time.monotonic()
    with _lock:
        cached = _cache.get(cache_key)
        if cached and cached[0] > now:
            _cache.move_to_end(cache_key)
            return cached[1]
        while _recent_requests and _recent_requests[0] <= now - 60:
            _recent_requests.popleft()
        if len(_recent_requests) >= 60:
            raise HTTPException(503, 'RetroAchievements is busy. Please try again shortly.')
        _recent_requests.append(now)
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, 'RetroAchievements is busy. Please try again shortly.')
    try:
        query = urlencode({'y': key, 'u': identifier, **params})
        request = Request(f'https://retroachievements.org/API/{endpoint}?{query}', headers={
            'Accept': 'application/json', 'User-Agent': 'OldStyleGaming/1.0',
        })
        with build_opener(NoRedirects()).open(request, timeout=10) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError('Oversized API response')
        data = json.loads(raw)
        if not isinstance(data, (dict, list)):
            raise ValueError('Invalid API response')
        if isinstance(data, dict) and data.get('Error'):
            raise HTTPException(502, 'RetroAchievements could not return this public profile. Check the username or try again later.')
        with _lock:
            _cache[cache_key] = (time.monotonic() + CACHE_SECONDS, data)
            _cache.move_to_end(cache_key)
            while len(_cache) > 256:
                _cache.popitem(last=False)
        return data
    except HTTPError as error:
        if error.code == 404:
            raise HTTPException(404, 'RetroAchievements profile not found.') from None
        if error.code in (401, 403):
            raise HTTPException(503, 'The site RetroAchievements API key needs to be checked.') from None
        raise HTTPException(502, 'RetroAchievements is unavailable. Please try again later.') from None
    except (URLError, OSError, ValueError):
        # Never include upstream exceptions/URLs: the query contains the secret API key.
        raise HTTPException(502, 'RetroAchievements could not be reached. Please try again later.') from None
    finally:
        _slots.release()


def number(value):
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def public_profile(identifier):
    data = request_public('API_GetUserProfile.php', identifier)
    if not isinstance(data, dict) or not data.get('User'):
        raise HTTPException(404, 'RetroAchievements profile not found.')
    username = str(data['User'])[:64]
    ulid = str(data.get('ULID') or '')
    return {
        'username': username,
        'ulid': ulid if re.fullmatch(r'[0-9A-HJKMNP-TV-Z]{26}', ulid) else None,
        'profile_url': f'https://retroachievements.org/user/{quote(username, safe="")}',
        'avatar_url': f'https://retroachievements.org/UserPic/{quote(username, safe="")}.png',
        'points': number(data.get('TotalPoints')),
        'softcore_points': number(data.get('TotalSoftcorePoints')),
        'true_points': number(data.get('TotalTruePoints')),
        'member_since': data.get('MemberSince'),
    }


def recent_unlocks(identifier):
    data = request_public('API_GetUserRecentAchievements.php', identifier, m=10080)
    if not isinstance(data, list):
        raise HTTPException(502, 'RetroAchievements returned an invalid recent achievement list.')
    results = []
    for item in data:
        if not isinstance(item, dict) or not number(item.get('AchievementID')):
            continue
        badge = str(item.get('BadgeName') or '')
        achievement_id = number(item['AchievementID'])
        results.append({
            'id': achievement_id, 'title': str(item.get('Title') or ''),
            'description': str(item.get('Description') or ''),
            'game_title': str(item.get('GameTitle') or ''), 'points': number(item.get('Points')),
            'hardcore': str(item.get('HardcoreMode')).lower() in ('1', 'true'),
            'awarded_at': str(item.get('Date') or ''),
            'badge_url': f'https://media.retroachievements.org/Badge/{badge}.png' if re.fullmatch(r'\d+', badge) else None,
            'url': f'https://retroachievements.org/achievement/{achievement_id}',
        })
    # One achievement may be returned for both softcore and hardcore unlocks.
    results.sort(key=lambda item: item['awarded_at'], reverse=True)
    unique = {}
    for item in results:
        unique.setdefault(item['id'], item)
    return list(unique.values())[:10]
