# MSX emulator preview

OldStyleGaming uses self-hosted **WebMSX 6.0.8** for MSX, MSX2 and MSX2+.
MSX remains an admin-only preview, enforced by the existing frontend and backend
system-access checks. There are no entitlement or database changes.

## Runtime and launcher

`frontend/public/msx/launcher.html` loads the unmodified embedded WebMSX release
from `webmsx/wmsx.js`, with the small integration in `launcher.js`. There is no
EmulatorJS, blueMSX, RetroArch, WASM build or public webmsx.org runtime dependency
in this launcher. Shared EmulatorJS assets used by other systems are untouched.
WebMSX branding remains intact, with a visible attribution link in the room.

Upstream revision, release path, SHA-256 and the unresolved upstream licence and
firmware redistribution notices are in `frontend/public/msx/webmsx/NOTICE.md`.
**Confirm those permissions before public release.** The full upstream release
contains system firmware; do not describe it as a C-BIOS-only distribution.

## Media flow

The existing RoomPage game/library/archive flow supplies `msx_autoload` with
`fileName`, `bytes`, and optionally a `media` array. The adapter also accepts File
objects and Blob bytes, retaining the original name/extension. It waits for
WebMSX firmware/extension loading to finish, powers the machine off, ejects old
media, inserts the new media and powers on once:

- `.dsk`: explicit floppy drive A, preserving supplied disk order; never passed
  to cartridge or hard-disk auto-detection. A failed mount reports a load error.
- `.rom`, `.mx1`, `.mx2`: cartridge slot 1, using WebMSX mapper detection.
- `.cas`: cassette deck and WebMSX's cassette auto-run command.
- `.m3u`: resolves entries only from accompanying supplied files. No URLs or
  arbitrary local paths are fetched. Select the playlist and its media together.
- ZIP/7z extraction remains in the existing room media flow.

WebMSX's normal automatic machine selection is retained (MSX2+ in the tested
English locale). Reset reloads the current media and boots afresh. Changing games
clears old disk/cartridge/tape media so they cannot take precedence over the next
launch. The room validator now includes MSX extensions, fixing its previous
fallback to the CPC-only file list.

## Existing room contracts

- `msx_start` / `amstrad_audio_unlock`: resume the emulator audio context.
- `msx_reset`: reload and boot the selected media.
- `emulator_set_paused` / `emulator_set_volume`: existing pause and volume flow.
- `getMsxAudioStream()`: returns the emulator audio MediaStream for existing
  room streaming/recording. The normal room canvas discovery/capture is retained.
- `msx_keyboard`: forwards keyboard events to WebMSX's input hub.
- `amstrad_remote_joystick`: the room's normalized masks drive MSX ports 1 and 2.
  Direction/fire bits map to the active-low MSX port; Start maps to Enter.
  Legacy `amstrad_remote_input` / `amstrad_remote_control` messages still work.
  RoomPage remains responsible for physical controller profiles and ownership.
- Messages must come from the same-origin parent frame.
- WebMSX stays in standalone mode, with no configured NetPlay server. Existing
  OldStyleGaming networking, joining, streaming and recording code is unchanged.
- The existing room Fullscreen control continues to control the room display.

## Browser verification

Development-only test page: start Vite and open `/tests/msx-smoke.html`, then
choose **Run tests**. It creates a 720 KiB FAT12 floppy with a self-authored BASIC
score game and a 16 KiB Z80 cartridge. No commercial game files are distributed.
The test checks emulated VRAM for program output, not merely a successful mount.
Download buttons provide the same fixtures for the actual RoomPage file picker.
The page is outside `public/` and is not included in the production build.

Verified in Edge on 2026-09-25:

- Floppy AUTOEXEC.BAS boots and prints `OSG DISK GAME BOOT OK`.
- Forwarded keyboard input changes the game's score.
- `.rom`, `.mx1`, `.mx2` File objects boot and print `OSG CARTRIDGE BOOT OK`.
- Disk-to-cartridge and cartridge-to-Blob-disk switching eject previous media.
- Cartridge reset boots again.
- Both player masks and release, pause/resume, and live audio/video tracks pass.
- Actual RoomPage, using a disposable local backend/database/admin account:
  disk and cartridge selected through its file input boot on the room display.
- The room's existing CSS fullscreen display renders the running disk game.
- Production `npm run build` passes from the staged MSX-only frontend source
  (the existing large-bundle warning remains). Backend Python compilation also
  passes; no Python files are changed.

Representative browser output:

```text
OldStyleGaming MSX: WebMSX 6.0.8 self-hosted runtime loaded
OldStyleGaming WebMSX: mounted floppy disk ["OSG Disk Game.dsk"]
OldStyleGaming WebMSX: machine booted MSX2PA
OldStyleGaming WebMSX: inserted cartridge OSG Cartridge.rom
OldStyleGaming WebMSX: machine booted MSX2PA
```

The user's Space Manbow image was not supplied for this run. Real game-specific
compatibility, physical controllers and a two-device live multiplayer session
still need acceptance testing; the adapter tests do not claim that coverage.
Cassette and playlist compatibility is not part of this first boot milestone.

## Deployment

Run the frontend production build and deploy its output, including `msx/webmsx/`.
The MSX iframe/launcher cache identifiers are updated. No backend restart,
new service, migration or emulator core rebuild is required by this change.
Remove obsolete deployed `msx/bluemsx-system-v2.zip` and `msx/blueMSX-license.txt`
when deploying if the asset-copy process retains deleted files. Do not delete
shared EmulatorJS cores used elsewhere. No new payment integration is included.

## Changed files

| File | Change |
| --- | --- |
| `frontend/public/msx/launcher.html` | Self-hosted WebMSX entry point |
| `frontend/public/msx/launcher.js` | MSX media/audio/input adapter |
| `frontend/public/msx/webmsx/wmsx.js` | Unmodified upstream embedded release |
| `frontend/public/msx/webmsx/.gitattributes` | Preserve exact vendored bytes |
| `frontend/public/msx/webmsx/NOTICE.md` | Provenance and unresolved licence notices |
| `frontend/public/msx/webmsx/UPSTREAM.md` | Preserved upstream README |
| `frontend/public/msx/blueMSX-license.txt` | Removed obsolete MSX-only notice |
| `frontend/public/msx/bluemsx-system-v2.zip` | Removed obsolete MSX-only firmware archive |
| `frontend/src/pages/RoomPage.jsx` | MSX cache identifier, file validation/message, attribution only |
| `frontend/tests/msx-smoke.html` | Development-only browser regression test |
| `docs/msx-emulator.md` | This integration and verification report |
