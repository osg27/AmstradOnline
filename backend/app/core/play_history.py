"""Heartbeat-derived attendance, not proof of active play or trusted peer telemetry."""
from datetime import timezone
from app.models.play_session import PlaySession
from app.models.user import User

TIMEOUT_SECONDS = 60


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def finish(row, when, reason):
    row.ended_at = when
    row.end_reason = reason
    row.peer_connected = False


def record_heartbeat(db, room, user_id, now, peer_connected=False):
    # The caller locks the room, so concurrent heartbeats cannot create duplicates.
    rows = db.query(PlaySession).filter_by(room_id=room.id, ended_at=None).all()
    current = None
    for row in rows:
        gap = (now - utc(row.last_seen_at)).total_seconds()
        if gap > TIMEOUT_SECONDS:
            finish(row, row.last_seen_at, 'heartbeat_timeout')
        elif utc(row.started_at).date() != now.date():
            finish(row, row.last_seen_at, 'daily_boundary')
        elif (row.system, row.game, row.mode) != (room.system, room.current_game, room.hosting_mode):
            finish(row, row.last_seen_at, 'game_or_mode_changed')
        elif row.user_id == user_id:
            current = row
    connected = bool(peer_connected and room.hosting_mode == 'multiplayer')
    if current is None:
        user = db.get(User, user_id)
        host = db.get(User, room.owner_user_id)
        current = PlaySession(room_id=room.id, room_code=room.room_code,
            user_id=user_id, username=user.username, host_id=room.owner_user_id,
            host_name=host.username, system=room.system, game=room.current_game,
            mode=room.hosting_mode, is_host=user_id == room.owner_user_id,
            started_at=now, last_seen_at=now, connected_seconds=0, duration_seconds=0,
            peer_connected=connected, ever_connected=connected)
        db.add(current)
    else:
        if current.peer_connected and connected:
            current.connected_seconds += max(0, int((now - utc(current.last_seen_at)).total_seconds()))
        current.last_seen_at = now
        current.duration_seconds = max(0, int((now - utc(current.started_at)).total_seconds()))
        current.peer_connected = connected
        current.ever_connected = current.ever_connected or connected


def record_leave(db, room_id, user_id):
    for row in db.query(PlaySession).filter_by(room_id=room_id, user_id=user_id, ended_at=None):
        finish(row, row.last_seen_at, 'left_room')


def serialize_session(row, now):
    timed_out = row.ended_at is None and (now - utc(row.last_seen_at)).total_seconds() > TIMEOUT_SECONDS
    return {
        'id': row.id, 'room_code': row.room_code, 'username': row.username,
        'host_name': row.host_name, 'is_host': row.is_host, 'system': row.system,
        'game': row.game, 'mode': row.mode,
        'started_at': utc(row.started_at).isoformat(),
        'ended_at': utc(row.ended_at or row.last_seen_at).isoformat() if row.ended_at or timed_out else None,
        'duration_seconds': max(0, int((utc(row.ended_at or row.last_seen_at) - utc(row.started_at)).total_seconds())),
        'end_reason': row.end_reason or ('heartbeat_timeout' if timed_out else None),
        'ever_connected': row.ever_connected, 'connected_seconds': row.connected_seconds,
    }
