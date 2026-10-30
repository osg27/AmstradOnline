# Pac-Man MAME 2003-Plus achievement preview

This isolated experiment translates one MAME game's RAM into the layout used by its RetroAchievements Arcade set. It offers a local preview and an optional Pac-Man softcore submission test. It does not enable RetroAchievements in normal Arcade rooms or replace their core.

## Try it

Deploy the frontend and restart the backend, then visit `/experiments/mame-retroachievements` while signed in. Connect your own RetroAchievements account in Profile first. Select your own complete `pacman.zip` MAME set. No ROM is included or uploaded to the server.

For a real softcore test, check **Submit Pac-Man softcore achievements to RetroAchievements** before choosing the file. The checkbox is off by default and locked during play. The game restarts when the achievement session is ready; no earlier preview hits are imported. Earn a new achievement, such as collecting the first cherry, and look for **confirmed by RetroAchievements** before checking your RA profile. Previously earned achievements are loaded from the session and are not awarded again. An unlock awaiting confirmation is not proof of a server unlock; keep the page open while pending requests sync.

Click the screen. Use arrows to move, `5` to insert a coin and `1` or Enter to start. Stop releases the preview; selecting the archive again starts a fresh instance. The preview uses temporary in-memory files only.

Standard browser gamepads are supported while the screen has focus: D-pad/left stick to move, Back/Select or B for a coin, Start or A to start. Press a controller button so the browser exposes it, then click the screen. Moving focus away releases controller input.

The isolated host copies the defaults supplied by the core's legacy `SET_VARIABLES` registration and returns them through `GET_VARIABLE`. Omitting these defaults left gamma at zero, which hid the maze and most text; the native rendering check now verifies blue maze pixels and visible score text during gameplay.

**Local preview remains read-only. Optional softcore mode submits activity and new unlocks to the connected user's RA account.** Hardcore is always disabled. [RetroAchievements' unknown-emulator policy](https://retroachievements.org/forums/topic/29231) allows softcore unlocks from unapproved emulators; its warning is not bypassed. MAME remains an [officially unsupported core](https://docs.retroachievements.org/developer-docs/unsupported-emulators-and-cores.html). This is an experimental adapter, not official MAME support. Other games need their own verified memory adapters.

## Isolation and transport

- Dedicated native artifacts under `frontend/public/experiments/mame-ra/`; normal EmulatorJS/MAME assets and launchers are untouched.
- A separate rcheevos build defaults to spectator mode. An experimental-only export selects softcore before loading; it refuses mode changes while a game is loaded. The production RA native binary is unchanged; its system allowlist still excludes Arcade.
- `/auth/retroachievements/mame-preview/session` returns only the signed-in user's remembered connection with `Cache-Control: no-store`.
- `/request` permits only token `login2` and `achievementsets` for the fixed Pac-Man archive hash. It verifies the saved username/token, rejects passwords, duplicate/extra fields and every mutation, including `startsession`, `ping`, and `awardachievement`.
- `/softcore/request` additionally permits `startsession`, `ping`, and `awardachievement`, bound to game `12192`, the Pac-Man archive hash, the saved user/token, and explicit `h=0`. Only Pac-Man core IDs `127619–127639` are accepted (verified against the public game API on 2026-10-30); warning/synthetic IDs, other games, hardcore, leaderboards and unexpected fields are rejected. The upstream User-Agent identifies OldStyleGaming and MAME 2003-Plus honestly.
- The native client generates award signatures and loads existing unlock history through `startsession`. The UI labels an unlock confirmed only after a successful award response. Preview requests still reject every write, and preview hits are never replayed as awards.
- Achievements requiring unmapped RAM are disabled rather than reading invented zeroes. Read failures are shown on the preview page. The user has observed fruit and other gameplay conditions firing locally. Full set coverage and live account confirmation still require testing; automated condition tests use offline fixtures, not real achievement claims.

## Pac-Man mapping

Source: MAME 2003-Plus `src/drivers/pacman.c` and FBNeo `src/burn/drv/pre90s/d_pacman.cpp` (`MemIndex` and default Pac-Man memory map).

| RA / FBNeo AllRam address | Isolated MAME source |
| --- | --- |
| `0400–07ff` | CPU `4c00–4fff` work RAM |
| `1000–100f` | physical `spriteram_2` (CPU reads at `5060` return inputs, so cannot be used) |
| `1010–140f` | `colorram`, CPU `4400–47ff` |
| `1410–180f` | `videoram`, CPU `4000–43ff` |
| Other addresses | unavailable |

FBNeo reference revision: `68d2df3b9908ea92b5792f46433e6358b32882e1`.
Pac-Man Arcade set: game `12192`; official archive-basename hash of `pacman`: `64d1f88b9b276aece4b0edcc25b7a434`. The official rcheevos Arcade file hashing function computes this from the archive name; MAME validates/loads the archive contents separately.

## Build

Requires Python 3, GNU make and Emscripten **3.1.57**. The script fetches pinned source archives, builds only the Pac-Man driver family, and links a standalone libretro host. It never builds or overwrites the normal Arcade core.

```powershell
python scripts/mame-ra-experiment/build.py --emscripten C:/path/to/emsdk/upstream/emscripten --make C:/msys64/usr/bin/make.exe
```

Pinned source and licenses:

- [MAME 2003-Plus df60f6466d678f38bcb978d73983c9c7ed2cba6e](https://github.com/libretro/mame2003-plus-libretro/tree/df60f6466d678f38bcb978d73983c9c7ed2cba6e) — classic MAME non-commercial license, copied beside the native artifacts. The build script records all source changes; `host.c` supplies the frontend and memory adapter.
- [rcheevos 1433173220a7eaede6a9ed7a18e94117be1821e0](https://github.com/RetroAchievements/rcheevos/tree/1433173220a7eaede6a9ed7a18e94117be1821e0) — MIT license, copied beside the native artifacts. Uses `scripts/retroachievements/client.c` with `OSG_MAME_RA_EXPERIMENT` defined.

## Checks

```powershell
node --test frontend/scripts/test-mame-ra-preview.cjs
# Optional local-ROM integration test; never distributes or downloads a game:
$env:PACMAN_TEST_ROM='D:/your/roms/pacman.zip'
node --test frontend/scripts/test-mame-ra-preview.cjs
$env:PYTHONPATH='backend'
python -m pytest backend/tests/test_retroachievements_mame_preview.py -q
npm run build --prefix frontend
```

The optional native test boots actual Pac-Man, inserts a coin through emulated controls, starts the game, compares all mapped work/video/colour RAM bytes and checks unmapped addresses fail closed. It also checks maze and score colours. Offline native tests verify preview makes no writes, softcore submits with `h=0`, running previews cannot be promoted, and previously earned achievements do not re-submit. Browser QA uses the real MAME build, a simulated standard controller and a mocked achievement server; it checks rendering, input, and confirmed/rejected award responses. No real unlock is submitted by automated tests.

