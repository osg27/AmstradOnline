# SNES RetroAchievements

SNES solo rooms reuse the existing Profile connection and official rcheevos softcore client. Load a supported SNES ROM from the shelf or PC, wait for its achievement set, then play. The same ROM must match a supported RetroAchievements hash. The official SNES hash removes a 512-byte copier header when present.

Deploy the frontend and restart the backend. No new environment variables or user credentials are required. Previous sign-in details remain in Profile. Tracking is disabled when guests can join and backend requests still require the solo room's owner.

## Native memory access

The site's existing EmulatorJS Snes9x core is retained. Its native `retro_get_memory_size` and `retro_get_memory_data` functions already exist but were not exported to JavaScript. `scripts/retroachievements/prepare-snes-core.py` adds two exports to that exact binary and exposes them on the Module. It does not recompile or change any WebAssembly instruction, global, import, or data section. The preparation script asserts this and checks both original JS/WASM SHA-256 digests before modifying anything.

Both normal and legacy graphics variants are prepared under `public/snes/snes9x-ra[-legacy]-wasm.data`; original cores under `public/emulatorjs` stay intact. The existing license, build information and core metadata are preserved in each bundle. The launcher uses query-aware EmulatorJS path overrides so report cache parameters cannot accidentally select the old core.

The existing Emscripten main-loop boundary calls an optional tracker callback. The SNES launcher checks the native frame counter, parent pause flag and emulator pause state before evaluating a frame. It detaches the callback on unload, stops tracking before game replacement, and uses the existing native restart function on reset instead of starting another emulator instance.

Reference: [Snes9x libretro memory getters](https://github.com/EmulatorJS/snes9x/blob/2d4cce69f4fe1c53a2c1423cdc06f2dea8b870a1/libretro/libretro.cpp). Pinned bundled core build: `2.0.2`, build report `2025-06-14T17:58:11+00:00`.

| Variant | Original WASM SHA-256 | Imported functions |
| --- | --- | --- |
| Normal | `2bc7b519bc185af151cc7ebc42c0a926a125be174c6467c24bb0495820adf0bf` | 459 |
| Legacy | `c3b930598155256dae0e4f66f2bb05c5dd6fc2366fbb5048a34dd61db392d1cf` | 451 |

Binaryen's defined-function labels `2192` and `2193` are the size and data getters. Absolute WASM export indices include the imported function count. These indices are valid only for the exact pinned binaries; the script rejects other revisions.

## Memory layout and limits

- Achievement offsets `000000–01ffff`: 128 KB native SNES WRAM, linear bytes, without byte swapping.
- Offsets starting at `020000`: cartridge SRAM/BW-RAM, limited to the size Snes9x exposes for the loaded ROM. Absent or out-of-range memory returns unavailable, never fabricated zeroes.
- Extra SA-1 I-RAM at achievement offset `0a0000` is not exposed by this bundled core. Conditions requiring it are disabled and shown as unavailable. This does not claim compatibility with every SNES achievement set.

## Reproduce and check

Requires Python 3 and 7-Zip. No game data is downloaded or included.

```powershell
python scripts/retroachievements/prepare-snes-core.py
node --test frontend/scripts/test-retroachievements-native.cjs
node frontend/node_modules/vitest/vitest.mjs run frontend/src/features/retroachievements/memory.test.js
python -m pytest backend/tests/test_retroachievements_play.py -q
npm run build --prefix frontend
```

The existing `scripts/build-retroachievements.ps1` builds the shared RA client; the preparation script above builds the SNES memory-access artifacts. Prebuilt native files are checked in, so server deployment does not require Emscripten or 7-Zip.

Verification uses the real browser Snes9x runtime and a local SNES ROM with a completely mocked achievement server. It covers automatic Profile sign-in, ROM hash matching, nonzero frame/read counts, zero unavailable reads for mapped conditions, pause, reset without duplicate awards, a mock softcore unlock, and tracking stopping when the room becomes multiplayer. Tests never submit synthetic unlocks to RetroAchievements. The first real unlock still needs user gameplay with a supported ROM.
