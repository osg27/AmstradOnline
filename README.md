# Amstrad Multiplayer Starter

This is a clean restart project for a **single-host Amstrad multiplayer architecture**:

- FastAPI backend
- React + Vite frontend
- PostgreSQL for users and rooms
- JWT auth
- WebSocket signaling for WebRTC
- Host/guest room pages
- WebRTC video + data channel starter flow

## Important

This project is a **working foundation**, not a finished Amstrad emulator product yet.

What is included:
- register/login
- create/join room
- signaling WebSocket
- host page can start a local WebRTC session
- host can share a screen/window/tab for low-latency streaming
- guest can receive the stream
- guest can send keyboard events over a WebRTC data channel
- host sees those input events in the UI log

What is **not** included yet:
- embedded Amstrad emulator
- emulator keyboard injection layer
- TURN server setup in compose
- production HTTPS reverse proxy
- spectator mode
- persistent session history

## Why this shape

The correct low-latency model for your use case is:

- one authoritative host session
- WebRTC media stream from host to guest
- WebRTC data channel inputs from guest back to host

Do **not** run two emulator instances and try to sync them.

## Local run

1. Copy `.env.example` to `.env`
2. Change passwords and secrets
3. Set `ADMIN_USERNAME` to the username that should be allowed to view `/admin`
4. Run:

```bash
docker compose up --build
```

Frontend:
- http://localhost:5173

Backend:
- http://localhost:8000
- docs: http://localhost:8000/docs

## VPS deployment notes

For a VPS you will usually want:

- domain name
- HTTPS
- reverse proxy (nginx)
- coturn for TURN/STUN
- frontend built to static files rather than Vite dev server
- backend running with a process manager

This starter is intentionally kept simple so you can prove the architecture first.

## Replace what you already have

Safest approach:

1. stop old containers/services
2. back up old project directory
3. upload this folder to a new directory first
4. test it on alternate ports or subdomain
5. once happy, switch nginx/reverse proxy across

## Next step after this starter

After you confirm this runs cleanly, the next step is:

- embed the Amstrad emulator into the host page
- capture the emulator canvas/video
- map data-channel keyboard events into the emulator input layer
