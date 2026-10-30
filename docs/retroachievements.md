# RetroAchievements

The Profile page displays public RetroAchievements points and recent unlocks.
Solo Mega Drive and Amstrad CPC rooms support softcore achievement earning using the official
rcheevos `rc_client`. Existing site achievements remain separate.

## Earning achievements

1. Launch a Mega Drive or Amstrad CPC game in solo mode, from the shelf or your PC.
2. Open Profile, click **Add RetroAchievements**, and sign in once with your own
   RA username and password. Return to a supported room; it connects automatically.
   Saving only a public username does not connect an account for earning.
3. The ROM is hashed by rcheevos. The panel identifies the game and achievement
   count, or explains that no matching set exists. Use a ROM version listed under
   Supported Game Files on the game's RetroAchievements page.
4. Play normally. Unlock notifications appear in the room and softcore unlocks
   are submitted to that RA account. The public Profile card may take five minutes
   to refresh because its API responses are cached. The room lists loaded
   achievements, requirements, measured progress and locked/unlocked states.

Everyone can use this in their own solo Mega Drive or Amstrad CPC rooms. Multiplayer and other
systems do not track achievements. Promoting a room to multiplayer stops tracking;
new solo rooms reuse the Profile connection automatically. Hardcore and leaderboard
submissions are disabled. No additional environment variable is needed for earning.
The existing site Web API key is only for the public Profile card.

Passwords are forwarded to RetroAchievements over HTTPS and are never saved.
The returned RA token is encrypted in a nullable user column with Fernet and a
per-user HKDF-derived key from the existing server `JWT_SECRET`. No extra environment
setting is needed. Keep the same `JWT_SECRET` across restarts/workers; rotating it
requires players to reconnect RA. No plaintext RA token goes into localStorage,
public profile responses, admin lists or logs. An authorized solo host can retrieve
their own remembered session into emulator memory via a no-store response.

Profile offers **Disconnect RetroAchievements**, which deletes the encrypted token.
An open room in another tab on the same browser also stops its local RA session
through BroadcastChannel. It does not revoke a token already loaded on another
device; leaving/reloading that room ends that local session. Site sign-out clears
the site login, while the encrypted RA connection remains attached to that site
account for its next login. RA may invalidate a token; reconnect in Profile if needed.
Never add player passwords or RA tokens to `.env`.

Routes: `GET/POST/DELETE /auth/profile/retroachievements/connection`,
`GET /auth/retroachievements/play/options`, and the authorized
`POST /auth/retroachievements/play/session` and `/request` transports.
Existing databases receive the nullable encrypted-token column on startup.

The authenticated backend transport accepts only the fixed RA RPC endpoint,
checks solo room ownership and a supported system, rejects hardcore requests, limits
requests, and does not cache credential responses. It forwards only actions used
by the official client; it cannot submit leaderboards.

## Amstrad CPC

CPC uses the existing CPCBox core. No emulator replacement or core-file changes
are required. The integration wraps the display callback once per emulated frame
and reads physical RAM (`pv.aM`), without CPU banking (`pv.T`) or ROM overlays.
RAM availability follows the selected 64K/128K/expanded model; uninstalled RAM is
reported unavailable rather than read as zeroes.

Load a supported `.dsk`/`.edsk` through the room. The original, extracted disk bytes
are hashed by the official rcheevos CPC whole-file algorithm (console 37).
Identification starts only after CPCBox successfully parses the same disk bytes.
A different disk loaded through the embedded controls stops tracking until a disk
is loaded through the room again. ZIP files must be extracted by the room loader
before matching. Snapshot/tape achievement support is not included in this version.

Reset clears achievement hit state; pause does not evaluate frames. A new disk
unloads the old set before boot. Multiplayer and CPC party rooms cannot earn.
The Profile connection and room achievement list work as they do for Mega Drive.

The offline native test covers both consoles through the actual JS memory readers;
CPC tests include base/extended physical RAM, bank independence, unavailable banks,
softcore submissions and reset behavior. Browser QA uses a local mock RA service;
no synthetic unlock is sent to a real account.

## Runtime sources and builds

- rcheevos 12.5, MIT: https://github.com/RetroAchievements/rcheevos/tree/1433173220a7eaede6a9ed7a18e94117be1821e0
- Integration: https://github.com/RetroAchievements/rcheevos/wiki/rc_client-integration
- wasm-genplus source: https://github.com/h1romas4/wasm-genplus/tree/6090aff9e9b2f578cd28882bd4571d2e35b1d674
- `scripts/retroachievements/client.c` bridges the official client to JS transport
  and game memory. `genplus-site.patch` records the existing site core changes
  plus the new RAM exports. `genplus-memory.c` is the incremental bridge for an
  already adapted core. RAM reads preserve Genesis Plus GX's raw word-swizzled
  layout. Existing Genesis sets rely on this legacy layout; converting to 68000
  CPU bus byte order breaks them. Cartridge SRAM follows the official memory map.
  See https://github.com/RetroAchievements/rcheevos/issues/302 and the upstream
  libretro `retro_get_memory_data` implementation. The native regression test
  exercises the actual JS bridge with both byte and word conditions.
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
