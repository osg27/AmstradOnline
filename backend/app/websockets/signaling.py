from collections import defaultdict
import asyncio
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from app.api.routes.rooms import require_system_access
from app.core.database import SessionLocal
from app.core.security import decode_access_token
from app.core.solo_room_abuse import require_open_solo_room, require_solo_activity_allowed
from app.models.room import Room, RoomAccess, RoomActivity
from app.models.user import User

router = APIRouter(tags=["signaling"])
# DEPLOYMENT WARNING: these connections and admission locks live in one process.
# Run exactly one backend worker/replica until room membership, capacity admission,
# and signaling broadcast move to shared state/pub-sub.
room_connections: Dict[str, List[WebSocket]] = defaultdict(list)
room_join_locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


@router.websocket("/ws/signaling/{room_code}")
async def signaling_ws(websocket: WebSocket, room_code: str):
    room_code = room_code.upper()
    protocols = websocket.scope.get("subprotocols", [])
    token = protocols[1] if len(protocols) == 2 and protocols[0] == "osg" else ""
    claims = decode_access_token(token)
    if not claims or not str(claims.get("sub", "")).isdigit():
        await websocket.close(code=4401)
        return
    with SessionLocal() as db:
        user = db.query(User).filter(User.id == int(claims["sub"])).first()
        room = db.query(Room).filter(Room.room_code == room_code).first()
        if not user or not room:
            await websocket.close(code=4404)
            return
        try:
            require_system_access(db, user.id, room.system or "cpc")
            require_open_solo_room(db, room)
        except HTTPException:
            await websocket.close(code=4403)
            return
        if room.hosting_mode == "solo" and room.owner_user_id != user.id:
            await websocket.close(code=4403)
            return
        if room.system == "arcade" and not room.arcade_multiplayer and room.owner_user_id != user.id:
            await websocket.close(code=4403)
            return
        if room.is_private and room.owner_user_id != user.id and not db.query(RoomAccess).filter(
            RoomAccess.room_id == room.id, RoomAccess.user_id == user.id,
        ).first():
            await websocket.close(code=4403)
            return
        if room.hosting_mode == "solo":
            now = datetime.now(timezone.utc)
            try:
                require_solo_activity_allowed(db, room, user.id, now)
            except HTTPException:
                await websocket.close(code=4429)
                return
            activity = db.query(RoomActivity).filter(
                RoomActivity.room_id == room.id, RoomActivity.user_id == user.id,
            ).first()
            if activity:
                activity.last_seen_at = now
            else:
                db.add(RoomActivity(room_id=room.id, user_id=user.id, last_seen_at=now))
            db.commit()
        user_id = user.id
        is_owner = room.owner_user_id == user_id
        capacity = room.party_max_players or 2
    async with room_join_locks[room_code]:
        if len(room_connections[room_code]) >= capacity:
            await websocket.close(code=4403)
            return
        await websocket.accept(subprotocol="osg")
        room_connections[room_code].append(websocket)

    try:
        await websocket.send_json({
            "type": "system",
            "message": f"Connected to signaling room {room_code}",
        })

        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                continue
            if not is_owner and data.get("type") in {
                "room-system-changed", "arcade-mode-changed", "party-assigned", "party-room-full",
                "party-turn", "arcade_seat_update", "arcade_start", "arcade_autoload",
                "amiga_start", "amiga_aga_start", "atari8_start", "atarist_start",
                "c64_start", "msx_start", "megadrive_start", "nes_start", "snes_start",
            }:
                continue
            for connection in list(room_connections[room_code]):
                if connection is not websocket:
                    await connection.send_json(data)

    except WebSocketDisconnect:
        pass
    finally:
        if websocket in room_connections[room_code]:
            room_connections[room_code].remove(websocket)

        if not room_connections[room_code]:
            del room_connections[room_code]
