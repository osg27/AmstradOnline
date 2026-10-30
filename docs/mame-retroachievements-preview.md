# Pac-Man MAME 2003-Plus achievement preview

This isolated experiment tests translating one MAME game's RAM into the layout used by its RetroAchievements Arcade set. It does not enable RetroAchievements in normal Arcade rooms or replace their core.

## Try it

Deploy the frontend and restart the backend, then visit `/experiments/mame-retroachievements` while signed in. Connect your own RetroAchievements account in Profile first. Select your own complete `pacman.zip` MAME set. No ROM is included or uploaded to the server.

Click the screen. Use arrows to move, `5` to insert a coin and `1` or Enter to start. Stop releases the preview; selecting the archive again starts a fresh instance. The preview uses temporary in-memory files only.

**This is a local condition preview, not achievement earning.** It does not update RetroAchievements points, unlocks, recent activity or played-game status. MAME is not an officially supported RetroAchievements core. Other games need their own verified memory adapters; this is not a generic MAME integration.

## Isolation and transport

- Dedicated native artifacts under `frontend/public/experiments/mame-ra/`; normal EmulatorJS/MAME assets and launchers are untouched.
- A separate rcheevos build sets spectator mode before loading a game. The production RA native binary is unchanged; its system allowlist still excludes Arcade.
- `/auth/retroachievements/mame-preview/session` returns only the signed-in user's remembered connection with `Cache-Control: no-store`.
- `/request` permits only token `login2` and `achievementsets` for the fixed Pac-Man archive hash. It verifies the saved username/token, rejects passwords, duplicate/extra fields and every mutation, including `startsession`, `ping`, and `awardachievement`.
- No achievement activity is submitted even when a local condition triggers. The offline native test asserts the complete request list is exactly login + definitions.
- Achievements requiring unmapped RAM are disabled rather than reading invented zeroes. Read failures are shown on the preview page. Actual upstream set coverage and gameplay conditions still require user testing; the automated condition test uses an offline fixture, not a real achievement claim.

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

The optional native test boots actual Pac-Man, inserts a coin through emulated controls, starts the game, compares all mapped work/video/colour RAM bytes and checks unmapped addresses fail closed. Browser QA uses the real MAME build and a mocked achievement server; it checks a local condition hit and no write requests. No real unlock is submitted by tests.
