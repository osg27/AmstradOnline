# Feature Index

## AUTHENTICATION
Frontend: `frontend/src/api/client.js`; `frontend/src/pages/{Login,Register,ForgotPassword,ResetPassword,VerifyEmail,ResendVerification}Page.jsx`
Backend: `backend/app/api/routes/auth.py`; `backend/app/core/{security,email,config}.py`
Database: `users`, `account_tokens`
Notes: access JWT + rotated HttpOnly refresh token; verification/reset email.

## USERS / PROFILES / ADMIN / VIP
Frontend: `ProfilePage.jsx`, `AdminPage.jsx`, `PlayerAvatar.jsx`, `vipMameCache.js`
Backend: `profile.py`, `admin.py`, VIP/role logic and file endpoints in `auth.py`, `core/migrations.py`
Database: `users`
Notes: VIP means tester/preview entitlement; no billing system.

## LOBBY / ROOMS
Frontend: `LobbyPage.jsx`, `RoomPage.jsx`, `PlayerBubble.jsx`
Backend: `routes/rooms.py`
Database: `rooms`, `room_activity`
WebSocket: `websockets/signaling.py`, `hooks/useSignaling.js`
Notes: REST lifecycle/heartbeat plus transient realtime state.

## MULTIPLAYER / PARTY / SPECTATORS
Frontend: `RoomPage.jsx`, `hooks/useSignaling.js`, `utils/webrtc.js`, `public/*/launcher*`
Backend: `websockets/signaling.py`, `routes/rooms.py`
Database: room metadata only
Notes: authoritative host streams WebRTC media; guests return input via data channels; no TURN.

## ROOM CHAT / AUDIO CHAT / OBS
Frontend: `components/RoomChat.jsx`, media/mic/OBS logic in `RoomPage.jsx`
Backend: WebSocket relay only
Database: none
Notes: room chat and media are transient.

## FRIENDS / DMS / INVITES
Frontend: `SocialSidebar.jsx`, `MemberMessages.jsx`, `MessagesPage.jsx`, `LobbyPage.jsx`
Backend: `routes/social.py`
Database: `friendships`, `room_invites`, `lobby_messages`, `direct_messages`
Notes: REST/polling, persistent messages and read state.

## LOCAL LIBRARY / ARTWORK
Frontend: `LocalLibraryPage.jsx`, `MyLocalGamesPage.jsx`, `localLibraryDb.js`, `features/localLibrary/**`, `features/amiga/**`, `data/**`
Backend: `routes/library_media.py`
Database: browser IndexedDB; server filesystem `library_media/`
Notes: File System Access API; OpenRetro/Libretro metadata and box art.

## EMULATORS
Frontend: launcher selection in `RoomPage.jsx`; runtimes under `frontend/public/{emulator-cpcbox,emulator,amiga,amiga-aga,puae-wasm,arcade,emulatorjs,c64,nes,snes,megadrive,pcengine,spectrum,atari8,atarist,x68000,playstation,saturn,saturn-beetle,webretro-saturn}`
Backend: restricted content/firmware endpoints in `auth.py`; room system metadata in `rooms.py`
Database: `rooms.system`, `rooms.current_game`
Notes: Dreamcast/pinball directories exist but readiness/exposure is unknown.

## CONTROLLERS
Frontend: `ControllerSetupWizardAutomatic.jsx`; `utils/{controllerFamilyDetection,controllerInputDetection,controllerMappingStorage,defaultControllerMappings,applyControllerMapping}.js`; `data/amstradControlProfiles.json`
Backend/Database: none
Notes: Gamepad API + localStorage + room/emulator input bridges.

## GENERAL HIGH SCORES
Frontend: `ScoreSubmitModal.jsx`, `utils/scoreOcr.js`, `api/scores.js`
Backend: `routes/scores.py`, `models/score.py`, `schemas/score.py`
Database: `scores`
Notes: manual/OCR submission with optional input replay.

## MAME / HI2TXT HIGH SCORES
Frontend: MAME sections in `RoomPage.jsx`; `public/arcade/launcher.js`; `data/mame*.js`
Backend: `routes/mame.py`, `services/mame_high_scores.py`, `models/mame_leaderboard.py`, `schemas/mame_leaderboard.py`, `data/mame_*`, `data/hi2txt-xml/**`
Database: `mame_leaderboard_games`, `mame_high_scores`
Supporting: `scripts/{calibrate-mame-hi,upsert-mame-score,delete-mame-score,replay-mame-score-diff}.py`; `backend/tests/test_mame_high_scores.py`
Notes: built-in/configured/hi2txt parsers; best score per user/ROM.

## AMIGA HIGH SCORES
Frontend: Amiga/score logic in `RoomPage.jsx`, `features/amiga/**`
Backend: `routes/amiga_scores.py`, `services/amiga_high_scores.py`, `highscores/amiga/**`
Database: `amiga_high_scores`
Supporting: `backend/tests/test_amiga_high_scores.py`
Notes: explicit Battle Squadron and Hybris extractors.

## TOURNAMENTS
Frontend: `TournamentsPage.jsx`, tournament branches in `RoomPage.jsx`, `TournamentNotifications.jsx`, `LobbyPage.jsx`
Backend: `routes/tournaments.py`, `models/tournament.py`, `schemas/tournament.py`, MAME service
Database: `tournaments`, `tournament_entries`, `tournament_scores`, `tournament_notifications`
Supporting: `backend/app/data/mame_tournament_*`; `scripts/generate_mame_tournament_hi_templates.py`; `backend/storage/tournaments`
Notes: timed MAME competitions; optional retained ROM; best score and attempts.

## FEEDBACK / NOTIFICATIONS
Frontend: `FeedbackPage.jsx`; app notification consumers
Backend: `routes/feedback.py`, `models/feedback.py`, `schemas/feedback.py`
Database: `feedback_items`, `feedback_comments`, `feedback_notifications`
Notes: category/status/comments and participant notifications.

## ACHIEVEMENTS
Frontend/Backend/Database: none found
Notes: `UNKNOWN — requires investigation`; appears unimplemented.

## DEPLOYMENT
Files: `docker-compose.yml`, `docker-compose.local.yml`, `.env.example`, `scripts/deploy-vps.sh`, `README.md`
Services: PostgreSQL 16, FastAPI/Uvicorn, React/Vite; nginx/systemd referenced externally
Notes: full production topology/TLS/backups/monitoring are not tracked.
