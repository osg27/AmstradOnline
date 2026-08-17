# AI / Developer Handover

## What Old Style Gaming Is

Old Style Gaming is a browser-based retro game library and multiplayer service. A room host runs one authoritative browser emulator, streams its canvas/audio over WebRTC, and receives guest controller/input over data channels. It also supports local catalogues, social features, general/MAME/Amiga high scores, timed MAME tournaments, feedback, administration, and restricted preview game catalogues.

Read `PROJECT_MAP.md` for feature-level flows, `FEATURE_INDEX.md` for a compact path lookup, `TECH_DEBT.md` before high-risk changes, and `CURRENT_STATE.md` before assuming a test result.

## Technology Stack

- Frontend: JavaScript/JSX, React 18.3, React DOM 18.3, React Router 6.28, Vite 5.4, Vitest 4.1, Bootstrap Icons 1.13, fflate 0.8, Tesseract.js 5, jsnes 2.1.
- Backend: Python 3.12 in Compose, FastAPI 0.115, Uvicorn 0.30, SQLAlchemy 2.0, Pydantic 2.9/pydantic-settings 2.5, psycopg2 2.9.
- Authentication: PBKDF2-SHA256 password hashes via Passlib; HS256 JWT by default; hashed opaque refresh/account tokens and HttpOnly refresh cookie.
- Database: PostgreSQL 16 in Compose. SQLAlchemy models plus startup-time conditional SQL in `backend/app/core/migrations.py`; no Alembic.
- Realtime/media: WebSockets for signaling/application relay, browser WebRTC for media/data, Web Audio/MediaDevices/Gamepad/File System Access/IndexedDB APIs.
- Emulation: multiple vendored JavaScript/WASM runtimes under `frontend/public/`; MAME uses EmulatorJS/MAME 2003 Plus; Amiga uses vAmiga and PUAE variants; see the system list below.
- Score extraction: built-in/configured Python readers, game-specific Amiga extractors, and external hi2txt command/JAR/XML data.

Exact emulator upstream versions are generally `UNKNOWN — requires investigation`; some runtime subtrees include `LICENSE`, `UPSTREAM.md`, or third-party notices.

## How To Run Locally

From the repository root:

```bash
cp .env.example .env
# Edit .env: use non-default passwords/JWT secret and appropriate SMTP/public URLs.
docker compose up --build
```

On Windows, copy `.env.example` to `.env` manually or with PowerShell. Default endpoints are frontend `http://localhost:5173`, backend `http://localhost:8000`, OpenAPI `http://localhost:8000/docs`, health `http://localhost:8000/health`.

For the local override:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

This override uses frontend host port 4173/origin settings. It also contains a tracked hard-coded `ADMIN_USERNAME`; review it for your environment.

Without Docker, install frontend dependencies in `frontend/` and run `npm run dev`. Install backend requirements in a Python environment, provide all required `.env` values (especially `DATABASE_URL`, `JWT_SECRET`), then run from `backend/`:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Docker Services

- `db` / container `amstrad_db`: PostgreSQL 16; host port 5432; persistent volume `amstrad_postgres_data`.
- `backend` / `amstrad_backend`: Python 3.12-slim; installs requirements at startup, runs Uvicorn on 8000; mounts `backend/`, `library_media/`, and volume `tournament_roms`.
- `frontend` / `amstrad_frontend`: Node 20; runs `npm install` then Vite dev server on 5173; source-mounts `frontend/`.

This is a development-oriented Compose topology, not sufficient evidence of production readiness.

## Frontend Architecture

- `App.jsx`: routes and auth/session shell.
- `pages/LobbyPage.jsx`: system/mode selection, room creation, social/tournament overview.
- `pages/RoomPage.jsx`: central emulator, multiplayer, capture, input, score, voice and OBS orchestrator. Treat changes as high risk.
- `pages/LocalLibraryPage.jsx`: system definitions, local/remote catalogues, folder scanning UI and art lookup. Also high risk due to size.
- `features/localLibrary/`: smaller scanning/grouping/manifest/storage/launch modules with unit tests.
- `features/amiga/`: manifest/OpenRetro/runtime/configuration helpers.
- `hooks/useSignaling.js`: WebSocket lifecycle.
- `api/client.js`: access-token fetch wrapper and refresh retry.
- `public/<system>/`: iframe emulator distributions and bridge launchers. These are not ordinary static decoration; many are runtime code.
- `styles.css`: application-wide styling; two controller/score components also have CSS files.

Runtime communication commonly uses `postMessage` between React and an emulator iframe. Local files are passed through browser/runtime registries or array buffers; host capture is streamed via WebRTC.

## Backend Architecture

`backend/app/main.py` creates tables, runs runtime migrations, configures CORS and includes routers. Routes contain much of the domain/query logic. `services/` contains score extraction; `models/` and `schemas/` describe persistence and HTTP shapes; `websockets/signaling.py` is a minimal relay. There is no repository/service layer despite the original request's terminology.

API prefixes: `/auth`, `/auth/profile`, `/auth/admin`, `/auth/social`, `/auth/feedback`, `/rooms`, `/scores`, `/scores/amiga`, `/mame` (also `/scores/mame`), `/tournaments` (also `/auth/tournaments`), `/library/media`, and `/ws/signaling`.

## Authentication

Registration hashes passwords and assigns a role based on configured usernames. Login returns an access JWT and sets an HttpOnly refresh cookie whose raw value is only held by the client; its hash is stored in `account_tokens`. `/auth/refresh` rotates/validates the session, `/logout` revokes it, and protected routes use `get_current_user` to parse `Authorization: Bearer` and load `users`.

Email verification and password reset use hashed expiring `account_tokens` and SMTP links. Roles are `user`, `tester`, and `admin`, with a configured super-admin username. Legacy `vip` and `xyphoe` roles are rewritten at startup. “VIP access” in the UI/API is tester/preview entitlement, not a paid subscription.

## Database

Engine/session setup: `backend/app/core/database.py`. Models:

- Accounts: `users` 1-to-many `account_tokens`.
- Rooms: `rooms` belongs to owner `users`; `room_activity` links room/user uniquely.
- Social: `friendships` links requester/addressee; `room_invites` links room/sender/recipient; `lobby_messages`; `direct_messages` with `read_at`.
- Scores: general append-only `scores`; best-per-user/game `mame_high_scores` and `amiga_high_scores`; MAME configuration `mame_leaderboard_games`.
- Tournaments: `tournaments`; unique user memberships `tournament_entries`; unique best user results `tournament_scores`; `tournament_notifications`.
- Feedback: `feedback_items`, `feedback_comments`, `feedback_notifications`.

Tables are created with `Base.metadata.create_all()` and altered at every startup by `ensure_runtime_columns()`. This must be replaced carefully with versioned migrations; it currently contains two hard-coded MAME score corrections.

## Multiplayer Architecture

1. Lobby creates/joins a SQL-backed room.
2. Each room browser opens `/ws/signaling/{room_code}` through `useSignaling.js`.
3. The backend accepts without authentication and broadcasts each JSON payload to every other socket in the same in-process list.
4. Host and guest exchange WebRTC SDP/ICE through that relay.
5. Host captures the local emulator canvas/video and audio; guest microphone can be added as a media track.
6. Guest controller/keyboard messages use WebRTC data channels and are mapped/injected at the host emulator. The host is authoritative; emulator states are not synchronized.
7. Party mode maintains multiple guest peer states and assigns player positions; excess guests can spectate.
8. REST heartbeat updates `room_activity`; transient chat/signaling/peer state is not durable.

No TURN service is defined. The relay cannot safely scale to multiple backend workers without shared state.

## Emulator Architecture

`RoomPage.jsx` maps room system identifiers to launcher URLs and behavior. The important detected IDs/integrations are:

- `cpc`/CPC party: `frontend/public/emulator-cpcbox/`; legacy `frontend/public/emulator/`; host bridge component `CanvasAmstradHost.jsx`.
- `amiga`, `amiga_aga`, link/PUAE variants: `frontend/public/amiga/`, `amiga-aga/`, `puae-wasm/`; helpers `frontend/src/features/amiga/`.
- `arcade`: `frontend/public/arcade/` plus `frontend/public/emulatorjs/`, MAME 2003 Plus.
- `c64`: `frontend/public/c64/`, VICE-derived.
- `nes`: `frontend/public/nes/`, jsnes.
- `snes`: `frontend/public/snes/`.
- `mastersystem`, `megadrive`: shared `frontend/public/megadrive/` launcher.
- `pcengine`: `frontend/public/pcengine/`.
- `spectrum`: `frontend/public/spectrum/`, JSSpeccy-derived.
- `atari8`: `frontend/public/atari8/`.
- `atarist`: `frontend/public/atarist/`, Hatari-derived.
- `x68000`: `frontend/public/x68000/`, keropi firmware; super-admin gated in parts of UI.
- `playstation`: `frontend/public/playstation/`.
- `saturn`, `saturn_beetle`: `frontend/public/saturn/`, `saturn-beetle/`, and `webretro-saturn/` variants.
- `dreamcast` and `emulator-pinball` assets exist but exposure/readiness is `UNKNOWN — requires investigation`.

Users generally supply ROMs locally. Restricted endpoints can deliver server-held content to testers/VIP users. Do not change public emulator binaries, firmware, bridge message formats, COOP/COEP behavior, or save paths without system-specific testing and licensing review.

## Major Features

See `FEATURE_INDEX.md` for exact compact paths and `PROJECT_MAP.md` for data flows. Entry points: rooms/multiplayer `RoomPage.jsx` + `rooms.py` + `signaling.py`; tournaments `TournamentsPage.jsx` + `tournaments.py`; MAME scores `mame.py` + `mame_high_scores.py`; achievements are not implemented.

## Important Configuration

Files: `.env.example`, `.env` (local/secret, never document or commit values), `docker-compose*.yml`, `frontend/vite.config.js`, `backend/app/core/config.py`, `scripts/deploy-vps.sh`.

Core environment keys: PostgreSQL credentials/`DATABASE_URL`; `JWT_SECRET`, algorithm and expiries; CORS/API/WS/public URLs; admin/super-admin/tester usernames; SMTP host/port/user/password/from identity; MAME hi2txt path/JAR/command/template/timeout/XML directory (some are consumed directly by the MAME service and not all are declared on `Settings`); server content library paths in `auth.py`.

Never paste `.env` values into documentation, logs, issues, prompts, or commits.

## Common Development Tasks

- Modify tournaments: start with `frontend/src/pages/TournamentsPage.jsx`, tournament sections of `RoomPage.jsx`, `backend/app/api/routes/tournaments.py`, `models/tournament.py`, and MAME service tests.
- Modify multiplayer rooms: `LobbyPage.jsx`, `RoomPage.jsx`, `useSignaling.js`, `utils/webrtc.js`, `routes/rooms.py`, `websockets/signaling.py`.
- Add an emulator/system: update the support matrix/system definitions in `LocalLibraryPage.jsx` and `LobbyPage.jsx`, room flags/launcher mapping/file validation in `RoomPage.jsx`, add a licensed `frontend/public/<system>/` bridge/runtime, extend local-library platform/launch modules, then test solo, host, guest, gamepad, audio, save and build behavior.
- Modify achievements: no implementation exists. Design models/API/UI and privacy/abuse rules first; do not assume scores equal achievements.
- Modify general scores: `ScoreSubmitModal.jsx`, `api/scores.js`, `utils/scoreOcr.js`, `routes/scores.py`, `models/score.py`.
- Modify MAME high scores: `RoomPage.jsx`, `public/arcade/launcher.js`, `routes/mame.py`, `services/mame_high_scores.py`, `models/mame_leaderboard.py`, `backend/app/data/mame_*`, and `backend/tests/test_mame_high_scores.py`.
- Modify Amiga high scores: `routes/amiga_scores.py`, `services/amiga_high_scores.py`, `highscores/amiga/`, and `backend/tests/test_amiga_high_scores.py`.
- Modify controller configuration: `ControllerSetupWizardAutomatic.jsx`, `utils/controller*.js`, `applyControllerMapping.js`, and RoomPage input loops; run all Vitest controller tests.
- Modify authentication/roles: `api/client.js`, auth pages, `routes/auth.py`, `core/security.py`, `models/user.py`; also inspect `admin.py`, `core/migrations.py` and every `is_tester`/VIP branch.
- Regenerate Amiga catalogue: run `npm run data:amiga` from `frontend/` with the required local `Amiga.sqlite`, then inspect generated `frontend/public/data/amiga/` changes.

## Dangerous Areas

- Preserve the dirty worktree and unrelated emulator build output; never use destructive resets or broad adds.
- `core/migrations.py` mutates live schema/data at import startup.
- `RoomPage.jsx` coordinates timing-sensitive browser APIs and many emulators.
- `frontend/public/**` contains third-party binaries/minified code and implicit bridge protocols.
- Tournament ROM and remote VIP endpoints handle copyrighted/untrusted files.
- WebSocket message changes can break all peers and old clients.
- Removing tracked `frontend/dist` may break undocumented VPS serving; verify first.
- Role names and hard-coded configured usernames are authorization behavior, not cosmetic labels.

## Known Problems

The prioritized register is `TECH_DEBT.md`. Most urgent: unauthenticated single-process signaling; no TURN; startup data mutations/no versioned migrations; incomplete licensing/provenance; no payments despite VIP terminology; insufficient backend tests/CI; upload security review; development-oriented deployment.

## Testing

Frontend from `frontend/`:

```bash
npm test
npm run build
```

On 2026-08-17: 9 test files/104 tests passed; build passed with a >500 kB chunk warning and Vite/Vitest esbuild-to-oxc deprecation warnings. There is no lint script.

Backend intended command from `backend/`:

```bash
python -m pytest -q
```

It currently fails immediately because pytest is not installed/declared. Do not claim backend tests pass until a pinned test environment is added and the suite runs. Existing tests only cover MAME and Amiga score services.

## Production / Deployment

Evidence only: `scripts/deploy-vps.sh` targets `/opt/amstrad-multiplayer` by default, installs an nginx HTML no-cache/revalidation fragment if possible, can use Docker Compose, and restarts detected nginx/Uvicorn/Vite/Node/amstrad services. The repository does not contain the full production nginx server block, TLS/cert setup, firewall, backup policy, monitoring, secrets manager, domain topology, or rollback proof. Therefore production behavior is partly `UNKNOWN — requires investigation`.
