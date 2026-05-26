from collections import defaultdict
from typing import Dict, List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["signaling"])
room_connections: Dict[str, List[WebSocket]] = defaultdict(list)


@router.websocket("/ws/signaling/{room_code}")
async def signaling_ws(websocket: WebSocket, room_code: str):
    await websocket.accept()
    room_code = room_code.upper()
    room_connections[room_code].append(websocket)

    try:
        await websocket.send_json({
            "type": "system",
            "message": f"Connected to signaling room {room_code}",
        })

        while True:
            data = await websocket.receive_json()
            for connection in list(room_connections[room_code]):
                if connection is not websocket:
                    await connection.send_json(data)

    except WebSocketDisconnect:
        if websocket in room_connections[room_code]:
            room_connections[room_code].remove(websocket)

        if not room_connections[room_code]:
            del room_connections[room_code]
