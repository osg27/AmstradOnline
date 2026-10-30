# RetroAchievements

The Profile page displays public RetroAchievements points and recent unlocks.
Solo Mega Drive rooms also support softcore achievement earning using the official
rcheevos `rc_client`. Existing site achievements remain separate.

## Earning achievements

1. Launch a Mega Drive game in solo mode, from the shelf or your PC.
2. In the room's RetroAchievements panel, sign in with your own RA username and
   password. This is separate from saving a public username on Profile.
3. The ROM is hashed by rcheevos. The panel identifies the game and achievement
   count, or explains that no matching set exists. Use a ROM version listed under
   Supported Game Files on the game's RetroAchievements page.
4. Play normally. Unlock notifications appear in the room and softcore unlocks
   are submitted to that RA account. The public Profile card may take five minutes
   to refresh because its API responses are cached.

Everyone can use this in their own solo Mega Drive rooms. Multiplayer and other
systems do not track achievements. Promoting a room to multiplayer signs RA out;
starting a new solo room requires signing in again. Hardcore and leaderboard
submissions are disabled. No additional environment variable is needed for earning.
The existing site Web API key is only for the public Profile card.

Passwords are forwarded to RetroAchievements over HTTPS, then discarded. The RA
session token stays in the emulator's memory, without localStorage or database
persistence. Refreshing or leaving the room ends the local sign-in. Do not add
player passwords or RA session tokens to `.env`.

The authenticated backend transport accepts only the fixed RA RPC endpoint,
checks solo room ownership and Mega Drive, rejects hardcore requests, limits
requests, and does not cache credential responses. It forwards only actions used
by the official client; it cannot submit leaderboards.

## Runtime sources and builds

- rcheevos 12.5, MIT: https://github.com/RetroAchievements/rcheevos/tree/1433173220a7eaede6a9ed7a18e94117be1821e0
- Integration: https://github.com/RetroAchievements/rcheevos/wiki/rc_client-integration
- wasm-genplus source: https://github.com/h1romas4/wasm-genplus/tree/6090aff9e9b2f578cd28882bd4571d2e35b1d674
- `scripts/retroachievements/client.c` bridges the official client to JS transport
  and game memory. `genplus-site.patch` records the existing site core changes
  plus the new RAM exports. `genplus-memory.c` is the incremental bridge for an
  already adapted core. RAM reads undo the core's 68000 byte swapping; cartridge
  SRAM follows the official console memory map.
- Generated JS/WASM and the rcheevos license are committed. A VPS only needs the
  usual frontend build and backend restart; it does not need Emscripten.
- To rebuild native assets on Windows (tested with Emscripten 3.1.57, CMake, Ninja):
  `./scripts/build-retroachievements.ps1 -EmsdkPath C:/path/to/emsdk`
  Missing source checkouts are cloned at the pinned revisions. Existing source
  checkouts are preserved. Use a fresh checkout to reproduce the full core patch.
- `npm run build` in frontend bundles the JS bridge as well as the app.
- Offline native test: `node --test frontend/scripts/test-retroachievements-native.cjs`.
  It mocks every RA RPC, evaluates a test condition, checks the softcore submission,
  reset behavior, ROM hashing, and credential-free UI events. It never contacts RA.

## Public profile setup

1. Obtain a Web API key from your RetroAchievements account control panel:
   https://retroachievements.org/controlpanel.php
2. Set `RETROACHIEVEMENTS_API_KEY` in the backend deployment environment or `.env`.
   Do not put the value in any `VITE_` variable, frontend file, or repository.
3. Restart/recreate the backend so the new environment variable is loaded.
   On a VPS, restart the service or process that runs the backend.
4. Open Profile, enter the public RetroAchievements username, and save.

No key is required to save/remove the username. Until the administrator configures
the key, the card explains that syncing is pending. A failed upstream lookup does
not prevent the rest of the player's profile loading. Once an account is resolved,
its ULID is stored to follow username changes.

## Requests and storage

- Authenticated routes: `GET/PATCH /auth/profile/retroachievements`.
- Uses `API_GetUserProfile.php` and `API_GetUserRecentAchievements.php`.
- All Web API requests originate on the backend. Redirects are rejected, errors
  are sanitized, responses are bounded to 2 MB, and requests time out after 10 seconds.
- Five-minute, 256-entry process-local cache, four concurrent upstream requests,
  and a shared limit of 60 upstream requests per minute.
- New nullable user fields are added by the existing startup migration helper.
- Avatar and badge images are requested directly from RetroAchievements without
  a referrer. Links open the public RetroAchievements pages.

The API key is not stored in the user table or returned to the browser. Removing
the profile clears both the saved username and ULID, without calling upstream.

Official documentation: https://api-docs.retroachievements.org/
