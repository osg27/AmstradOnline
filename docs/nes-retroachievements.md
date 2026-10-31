# NES RetroAchievements

NES solo rooms use the existing Profile connection and official softcore rcheevos client. Deploy the frontend and restart the backend, refresh the page, then load a supported `.nes` ROM from the shelf or PC. No additional settings or environment variables are needed. The official NES hash handles the iNES header rather than hashing the whole file.

Only the room's solo owner can obtain the remembered session or forward achievement requests. Switching to multiplayer stops tracking. Reset uses the existing native restart; replacing a ROM cleanly reloads the iframe and does not leave a second native loop running.

## Existing FCEUmm core

The emulator remains FCEUmm core `2.0.2`. `scripts/retroachievements/prepare-nes-core.py` reuses the SNES core preparation helpers to expose two existing native getters and an optional main-loop callback. The WebAssembly export section changes; all instruction, data, global and import sections remain identical. Existing controls and rendering are retained.

The original legacy `.data` in this checkout was truncated (378,428 bytes, invalid 7z archive). It was restored from the complete **same-release** `@emulatorjs/core-fceumm@4.2.3` package, whose embedded core version is `2.0.2`. The complete source bundle is 1,053,006 bytes, SHA-256 `f1054b094e7149fd6278485bc1b2e51ff75c5259048ddb1134171e53d651f239`. No newer emulation core was substituted.

| Variant | Original WASM SHA-256 | Imported functions | Page[] | Unmapped sentinel |
| --- | --- | --- | --- | --- |
| Normal | `2506285b7d10c8edfee17961e83e44dbaed9b2389199844c2c097d16b3b0a6f1` | 459 | 2183088 | 2174896 |
| Legacy | `86b8aca214421da72b2eb4827c93bddc8bd35c5e529f141de74ab5c5f57c8b8e` | 451 | 2182768 | 2174576 |

Binaryen defined-function labels `4360`/`4361` are `retro_get_memory_size`/`retro_get_memory_data`. These are exported with the imported-function count added to their index. Page[] and the 8192-byte unmapped sentinel addresses are verified from `CartBR` (defined function `4359`) and `ResetCartMapping` (`785`) in these exact binaries. The preparation script checks the entire original JS/WASM SHA-256 before applying the bridge, and refuses other builds.

Source references: [FCEUmm libretro memory getters](https://github.com/EmulatorJS/libretro-fceumm/blob/e1630de02074801eb96f3bc4ff33f69df9554c69/src/drivers/libretro/libretro.c), [cart memory mapping and sentinel](https://github.com/EmulatorJS/libretro-fceumm/blob/e1630de02074801eb96f3bc4ff33f69df9554c69/src/cart.c). The original license and build metadata remain in both prepared archives.

## Memory mapping

- `0000–07ff`: native 2 KB system RAM.
- `0800–1fff`: mirrors of that same RAM, wrapping every 2 KB.
- `4020–ffff`: currently mapped cartridge pages, using FCEUmm's live 2 KB Page[] table. This covers mapped nonbattery work RAM as well as battery-backed RAM and the current PRG-ROM banks. It does not assume the native save-file buffer describes all cartridge RAM.
- Hardware register reads and unmapped cartridge pages return unavailable. The tracker never invokes CPU I/O handlers, changes a PPU latch, or treats the core's placeholder buffer as real zero-filled memory. Unsupported conditions are disabled and shown in the room panel.

This is NES cartridge support; it does not claim full Famicom Disk System or every unusual mapper/register achievement condition.

## Build and verify

Requires Python 3 and 7-Zip to regenerate the prebuilt native artifacts. Server deployment needs neither.

```powershell
python scripts/retroachievements/prepare-nes-core.py
node --test frontend/scripts/test-retroachievements-native.cjs
node frontend/node_modules/vitest/vitest.mjs run frontend/src/features/retroachievements/memory.test.js
python -m pytest backend/tests/test_retroachievements_play.py -q
npm run build --prefix frontend
```

Checks cover native softcore evaluation, iNES hash normalization, RAM mirrors, cartridge bank changes, absent mappings, hardware-register rejection, native frame progression, pause, reset without duplicate awards, and solo-only transport. Browser checks use a local NES ROM and a completely mocked achievement server; no synthetic unlock is sent upstream. The shared helper refactor produces byte-identical SNES artifacts.
