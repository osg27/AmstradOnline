# Old Style Gaming Project Map

This is the authoritative code map for the repository as audited on 2026-08-17. Paths are repository-relative. `UNKNOWN — requires investigation` means the repository does not supply enough evidence.

## Application Shell and Navigation

Purpose: React single-page application, protected routes, session restoration, and navigation.

Frontend: `frontend/src/main.jsx`, `frontend/src/App.jsx`, `frontend/src/api/client.js`, `frontend/src/styles.css`.

Backend: `backend/app/main.py`, `backend/app/core/config.py`.

Database: none directly.

External dependencies: React 18, React Router 6, Vite 5.

Flow: Vite loads `main.jsx` -> `App.jsx` restores `/auth/me` through the API client -> React Router renders public or protected pages.

## Authentication and Account Recovery

Purpose: registration, login, refresh/logout, email verification, password reset, JWT access tokens and secure refresh cookies.

Frontend: `frontend/src/pages/LoginPage.jsx`, `RegisterPage.jsx`, `ForgotPasswordPage.jsx`, `ResetPasswordPage.jsx`, `VerifyEmailPage.jsx`, `ResendVerificationPage.jsx`, `frontend/src/api/client.js`.

Backend: `backend/app/api/routes/auth.py`, `backend/app/core/security.py`, `backend/app/core/email.py`, schemas in `backend/app/schemas/auth.py`.

Database: `users`, `account_tokens`.

External dependencies: python-jose, Passlib PBKDF2-SHA256, SMTP.

Flow: browser posts credentials -> auth route verifies/hash-checks -> access JWT is returned and a hashed refresh session is stored in `account_tokens` -> HttpOnly refresh cookie renews the access token. Verification/reset links use hashed, expiring account tokens and SMTP.

## Users, Profiles, Roles, Admin and Preview/VIP Access

Purpose: current-user identity, avatars, activity, role assignment, user statistics/deletion, and restricted remote game/firmware catalogues.

Frontend: `frontend/src/pages/ProfilePage.jsx`, `AdminPage.jsx`, `frontend/src/components/PlayerAvatar.jsx`, `PlayerBubble.jsx`, `frontend/src/vipMameCache.js`, VIP branches in `LobbyPage.jsx`, `LocalLibraryPage.jsx`, and `RoomPage.jsx`.

Backend: `backend/app/api/routes/profile.py`, `admin.py`, role and VIP/preview endpoints/helpers in `auth.py`, `backend/app/core/migrations.py`.

Database: `users` and user-owned rows in rooms, scores, social, feedback, and tournaments.

External dependencies: filesystem-backed ROM/firmware libraries configured by server paths in `auth.py`; JSON catalogues under `backend/app/data/*_vip_catalog.json`.

Flow: access JWT identifies the user -> dependency loads `users` row -> role helpers expose `is_admin`, `is_super_admin`, `is_tester`/VIP flags -> UI and protected endpoints enforce access. There is no payment or subscription implementation.

## Lobby and Room Lifecycle

Purpose: choose a system/mode, create or join a room, track participants, selected game, party size, and host heartbeat.

Frontend: `frontend/src/pages/LobbyPage.jsx`, `RoomPage.jsx`, `frontend/src/components/PlayerBubble.jsx`, `SocialSidebar.jsx`.

Backend: `backend/app/api/routes/rooms.py`, schemas `backend/app/schemas/room.py`, signaling `backend/app/websockets/signaling.py`.

Database: `rooms`, `room_activity`, `users`.

Flow: lobby posts `/rooms/create` or `/rooms/join` -> backend persists/returns room -> browser opens `/room/:roomCode`, polls/heartbeats through REST, and opens `/ws/signaling/:roomCode` for live peer negotiation and room events.

## Multiplayer, WebRTC, Party Play and Spectators

Purpose: single authoritative host streams emulator video/audio; guests send controls and optionally voice; party modes assign player numbers and allow spectators.

Frontend: `frontend/src/pages/RoomPage.jsx`, `frontend/src/hooks/useSignaling.js`, `frontend/src/utils/webrtc.js`, emulator bridge scripts under `frontend/public/*/launcher.js` and launcher HTML files.

Backend: `backend/app/websockets/signaling.py`, `backend/app/api/routes/rooms.py`.

Database: `rooms`, `room_activity`; transient peer state is not persisted.

External dependencies: browser WebRTC, WebSocket, MediaStream/canvas capture, Gamepad API. STUN uses browser peer configuration; no repository-provided TURN service.

Flow: peers join the same signaling code -> WebSocket blindly relays SDP/ICE and application messages -> host creates RTCPeerConnection(s), captures emulator canvas/audio, and opens data channels -> guest receives media and returns mapped input -> host launcher injects input. Party host maintains multiple peer connections in browser memory.

## Room Text Chat, Direct Messages, Friends and Notifications

Purpose: transient room chat over signaling, persistent DMs, friend requests/list, room invitations, unread indicators, feedback notifications, and tournament notifications.

Frontend: `frontend/src/components/RoomChat.jsx`, `MemberMessages.jsx`, `SocialSidebar.jsx`, `TournamentNotifications.jsx`, `frontend/src/pages/MessagesPage.jsx`, social sections of `LobbyPage.jsx`.

Backend: room relay in `backend/app/websockets/signaling.py`; persistent social API in `backend/app/api/routes/social.py`; feedback/tournament notification routes in `feedback.py` and `tournaments.py`.

Database: `friendships`, `room_invites`, `lobby_messages`, `direct_messages`, `feedback_notifications`, `tournament_notifications`.

Flow: room chat is sent as a WebSocket message and is not stored. DMs/friend actions use `/auth/social/*`, persist through SQLAlchemy, and are polled by the UI. Feature-specific notifications are stored and marked read through their APIs.

## Audio and Voice Chat

Purpose: emulator audio distribution and optional guest microphone audio.

Frontend: media-track and microphone/device logic in `frontend/src/pages/RoomPage.jsx`; audio bridges in emulator launchers.

Backend/Database: signaling relay only; no audio storage.

External dependencies: Web Audio/MediaDevices/WebRTC.

Flow: browser captures emulator audio and/or microphone -> tracks are added/replaced on peer connections -> remote `<audio>` elements play them after browser permission is available.

## Emulator Runtime and Systems

Purpose: launch local user-supplied games in browser emulators and bridge media/input/state to the React room.

Frontend: selection/orchestration is concentrated in `frontend/src/pages/RoomPage.jsx`; emulator runtimes live in `frontend/public/`. Detected integrations: Amstrad CPC (`emulator-cpcbox`, legacy `emulator`), Amiga/vAmiga (`amiga`), Amiga AGA/PUAE (`amiga-aga`, `puae-wasm`), MAME 2003 Plus (`arcade`, EmulatorJS assets), C64/VICE (`c64`), NES/jsnes (`nes`), SNES (`snes`), Mega Drive/Master System (`megadrive`), PC Engine (`pcengine`), ZX Spectrum/JSSpeccy (`spectrum`), Atari 8-bit (`atari8`), Atari ST/Hatari (`atarist`), Sharp X68000/keropi (`x68000`), PlayStation (`playstation`), Saturn (`saturn`, `saturn-beetle`, `webretro-saturn`), plus present but not clearly exposed runtime trees `dreamcast` and `emulator-pinball`.

Backend: firmware/remote library delivery in `backend/app/api/routes/auth.py`; room metadata in `rooms.py`.

Database: room `system` and `current_game`; ROMs themselves are not stored in the main database.

External dependencies: numerous vendored/upstream JavaScript/WASM emulator builds and firmware. Attribution varies by runtime; see runtime `LICENSE`, `UPSTREAM.md`, and notices where present.

Flow: room chooses a launcher URL -> local file/folder or authorized remote file is loaded -> React posts messages into iframe -> launcher mounts media/starts emulator and exposes capture/input/save bridges -> React handles multiplayer and scores.

## Local Game Library, Catalogues and Artwork

Purpose: scan browser-selected folders, normalize/group releases, remember preferred variants, present a console-style catalogue, and cache box art.

Frontend: `frontend/src/pages/LocalLibraryPage.jsx`, `MyLocalGamesPage.jsx`, `frontend/src/localLibraryDb.js`, all modules under `frontend/src/features/localLibrary/`, Amiga metadata under `frontend/src/features/amiga/`, title data under `frontend/src/data/`, and logos under `frontend/assets/`.

Backend: `backend/app/api/routes/library_media.py`; imported catalogue files under `frontend/public/data/amiga/`; generator `scripts/import-openretro-amiga.py`.

Database: browser IndexedDB for directory handles/library metadata; server filesystem `library_media/` for artwork cache. No SQL catalogue tables.

External dependencies: File System Access API, IndexedDB, OpenRetro SQLite exports, Libretro thumbnail GitHub/tree and thumbnail endpoints.

Flow: user grants a folder handle -> scanner filters and hashes files -> grouping/normalization creates game/release manifests in IndexedDB -> artwork is fetched directly or proxied/cached by `/library/media` -> launch adapter navigates to a solo room and passes runtime files through an in-memory registry.

## General Scores and OCR Submission

Purpose: user-submitted per-system/game scores, leaderboards, personal results, and optional input replay.

Frontend: `frontend/src/components/ScoreSubmitModal.jsx` and CSS, `frontend/src/utils/scoreOcr.js`, `frontend/src/api/scores.js`.

Backend: `backend/app/api/routes/scores.py`, `backend/app/models/score.py`, schemas `backend/app/schemas/score.py`.

Database: `scores`.

External dependencies: Tesseract.js for browser OCR.

Flow: user captures/enters a score -> frontend optionally OCRs image -> `/scores/submit` persists it -> leaderboard/personal/recent routes query results.

## MAME High Scores and hi2txt

Purpose: extract authoritative high scores from browser MAME `.hi`/NVRAM save data and maintain per-ROM best-score tables.

Frontend: MAME save/extraction orchestration and leaderboard UI in `frontend/src/pages/RoomPage.jsx`; launcher bridge `frontend/public/arcade/launcher.js`; titles in `frontend/src/data/mame*.js`.

Backend: `backend/app/api/routes/mame.py`, `backend/app/services/mame_high_scores.py`, models/schemas `mame_leaderboard.py`; configuration JSON under `backend/app/data/mame_*`; maintenance scripts `calibrate-mame-hi.py`, `upsert-mame-score.py`, `delete-mame-score.py`, `replay-mame-score-diff.py`.

Database: `mame_leaderboard_games`, `mame_high_scores`.

External dependencies: hi2txt executable/JAR/XML database; an untracked upstream `hi2txt-xml/` checkout is present locally, while a large tracked XML definition set also exists at `backend/app/data/hi2txt-xml/`.

Flow: launcher exports save files -> browser uploads multipart files to extraction endpoint -> service validates/configures ROM parser, writes an OS-temp session, invokes configured/built-in parser, upserts the user's best score, and removes temp files -> leaderboard response refreshes UI.

## Amiga High Scores

Purpose: extract game-specific scores from Amiga memory/save snapshots.

Frontend: Amiga runtime integration in `RoomPage.jsx` and `frontend/src/features/amiga/`.

Backend: `backend/app/api/routes/amiga_scores.py`, `backend/app/services/amiga_high_scores.py`, registry/comparison/extractors under `backend/app/highscores/amiga/`.

Database: `amiga_high_scores`.

External dependencies: game-specific binary formats; currently explicit extractors for Battle Squadron and Hybris.

Flow: browser sends game key and extracted bytes -> registered extractor derives candidate score -> comparison/upsert retains best -> leaderboard route returns ranked users.

## Tournaments

Purpose: create public/private timed MAME tournaments, retain an optional tournament ROM, join, play, extract scores, rank entries, notify displaced players, and administer leaderboard data.

Frontend: `frontend/src/pages/TournamentsPage.jsx`, tournament mode in `RoomPage.jsx`, `frontend/src/components/TournamentNotifications.jsx`, tournament sections in `LobbyPage.jsx`.

Backend: `backend/app/api/routes/tournaments.py`, model/schema `tournament.py`, MAME extraction service, seed/catalogue JSON under `backend/app/data/mame_tournament_*`, generator `scripts/generate_mame_tournament_hi_templates.py`.

Database: `tournaments`, `tournament_entries`, `tournament_scores`, `tournament_notifications`; retained ROM files use `backend/storage/tournaments` or Docker volume `tournament_roms`.

Flow: creator posts multipart tournament data -> API validates dates/ROM and saves record/file -> users join -> game endpoint supplies metadata/file -> MAME save files are extracted -> best score and attempts update -> leaderboard and notifications update.

## Feedback

Purpose: submit bugs/requests, comment, track status, and notify participants.

Frontend: `frontend/src/pages/FeedbackPage.jsx` and feedback notifications consumed in the app shell.

Backend: `backend/app/api/routes/feedback.py`, model/schema `feedback.py`.

Database: `feedback_items`, `feedback_comments`, `feedback_notifications`.

Flow: authenticated user posts feedback -> database row is created -> comments/status changes generate notifications -> UI polls and marks them read.

## Controller Configuration

Purpose: detect controller family/input, supply defaults, guide remapping, persist mappings, and translate gamepad state for emulators/remote play.

Frontend: `frontend/src/components/ControllerSetupWizardAutomatic.jsx` and CSS; utilities `controllerFamilyDetection.js`, `controllerInputDetection.js`, `controllerMappingStorage.js`, `defaultControllerMappings.js`, `applyControllerMapping.js`; Amstrad profiles `frontend/src/data/amstradControlProfiles.json`; consumption in `RoomPage.jsx`.

Backend/Database: none; browser storage only.

External dependencies: Gamepad API and localStorage.

Flow: wizard samples Gamepad API -> identifies family/buttons -> mapping is saved locally -> room input loop transforms masks/actions -> local launcher or WebRTC data channel receives controls.

## OBS / Streamer View

Purpose: expose a clean capture-oriented room view/window for OBS.

Frontend: query/window/title and `OBS view` logic in `frontend/src/pages/RoomPage.jsx`, associated styles in `frontend/src/styles.css`.

Backend/Database: none beyond normal room APIs.

Flow: user opens the OBS capture variant -> same room/emulator renders with capture-focused chrome and title -> OBS captures the browser source/window.

## Achievements

Purpose: UNKNOWN — requires investigation. No achievements UI, route, model, table, or service was found.

## Deployment and Operations

Purpose: local containers and VPS update/restart helper.

Files: `docker-compose.yml`, `docker-compose.local.yml`, `.env.example`, `.gitignore`, `scripts/deploy-vps.sh`, `README.md`.

External dependencies: Docker Compose, PostgreSQL 16, Python 3.12, Node 20, nginx/systemd on the VPS.

Flow: Compose runs database, source-mounted Uvicorn backend, and Vite dev frontend. VPS script pulls/builds as configured, installs an nginx HTML revalidation fragment, and restarts detected services. The complete production nginx virtual host and TLS configuration are not in this repository.
