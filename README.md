# Old Style Gaming

This is a clean restart project for a **single-host retro multiplayer architecture**:

- FastAPI backend
- React + Vite frontend
- PostgreSQL for users and rooms
- JWT auth
- WebSocket signaling for WebRTC
- Host/guest room pages
- WebRTC video + data channel starter flow

## Important

This project is a **working foundation**, not a finished emulator product yet.

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
4. Set `PUBLIC_APP_URL` and the `SMTP_*` values to send verification and password-reset emails
5. Run:

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

## MAME high score leaderboards

Current MAME runs in the browser through `frontend/public/arcade/launcher.js` using EmulatorJS with the `mame2003_plus` core. The backend does not launch MAME or maintain native MAME session folders yet. EmulatorJS mounts save data inside the browser Emscripten filesystem at `/data/saves`, and the room page exports those MAME-generated save files to the backend before a ROM change, reset, or host leave.

Backend extraction lives in `backend/app/services/mame_high_scores.py` and the API routes are under `/mame`, with a production-safe alias under `/scores/mame` for deployments that already proxy `/scores` to FastAPI. A transient extraction folder is created under the OS temp directory at `oldstylegaming-mame-sessions/<session>/<rom>/`, parsed, then removed after extraction.

Supported ROMs are controlled by the `mame_leaderboard_games` table. Seed rows are enabled for the first classic `.hi` set: `puckman`, `pacman`, `mspacman`, `dkong`, `dkongjr`, `dkong3`, `galaga`, `frogger`, and `1942`. New ROMs can be created automatically as `hi2txt`-backed entries the first time a score save is attempted. Parser values are:

- `mame_hi_bcd`: built-in exact parser for calibrated `.hi` layouts. Currently used for Donkey Kong.
- `1942_hi`: built-in exact parser for 1942. It ignores the factory default table and only saves the highest non-default player score found in `1942.hi`.
- `truxton_hi`: built-in exact parser for Truxton. It reads the 4-byte BCD score table, multiplies stored values by 10, and ignores the factory defaults.
- `hi2txt`: server-side `hi2txt` command support for broad MAME `.hi` extraction.
- `custom`: placeholder parser for future ROM-specific readers.
- `unsupported`: skips extraction.

Install `hi2txt` on the backend host and make it available on `PATH`, or set `MAME_HI2TXT_PATH=/path/to/hi2txt`. If your `hi2txt` build expects different arguments, set `MAME_HI2TXT_COMMAND_TEMPLATE`, for example `"/path/to/hi2txt {rom} {file}"`. The default command is `hi2txt <rom> <hi-file>`.

To add or tune a game manually, update its row with `rom_name`, `display_name`, `leaderboard_supported=true`, `score_source` (`hi` or `nvram`), `parser`, and `enabled=true`.

For calibrating another `.hi` file from a known visible score, run:

```bash
python scripts/calibrate-mame-hi.py <rom> /path/to/game.hi <known-score>
```
