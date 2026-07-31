# Amiga automatic configuration plan

## Architecture audit

The frontend is React 18 with Vite (`frontend/src`) and static emulator runtimes under
`frontend/public`. The backend is FastAPI, SQLAlchemy and WebSockets (`backend/app`). Room
creation and validation are in `backend/app/api/routes/rooms.py` and
`backend/app/schemas/room.py`; WebRTC signalling is in `backend/app/websockets/signaling.py`.

The primary local library is `frontend/src/pages/LocalLibraryPage.jsx`. It uses the File
System Access API (`showDirectoryPicker`), recursively walks the selected directory and
stores directory/file handles in IndexedDB through `frontend/src/localLibraryDb.js`. Games
and scan results are cached there, so selecting a game does not rescan the library. The older
`MyLocalGamesPage.jsx` uses a `webkitdirectory` input and the reusable scanner under
`frontend/src/features/localLibrary`; it must remain functional, but new work will reuse the
primary IndexedDB handle store.

Amiga is currently exposed twice: `amiga` (labelled A500) runs vAmiga from
`frontend/public/amiga`, while `amiga_aga` (labelled A1200) runs a locally built PUAE
libretro core from `frontend/public/amiga-aga/launcher.html` and
`frontend/public/puae-wasm`. Stored room IDs and URLs depend on both IDs, so the UI will
present one `amiga` platform while treating `amiga_aga` as a compatibility alias/profile.

The A500 launcher accepts one disk at a time and injects Kickstart bytes through vAmiga's
`kickstart_rom` message. The AGA launcher writes an uploaded Kickstart into PUAE's Emscripten
system directories as `kick40068.A1200`, writes ordered disks plus an M3U, and writes a fixed
RetroArch core-options file. `RoomPage.jsx` stores selected ROM bytes in a separate IndexedDB
database and posts them to the iframe. This is local-only, but storing whole ROM bytes will be
replaced for the new folder workflow by retained file handles and just-in-time reads.

ZIP files in the primary library are currently indexed but not inspected. The reusable
scanner hashes only optional whole-file SHA-256 values. Filename normalization and grouping
live in `normalise.js` and `group.js`. AGA already supports ordered multi-disk M3U launch and
disk selection; vAmiga swaps DF0 through its existing host control. `RoomPage.jsx` is a
host-emulator streaming design: only the host runs the emulator, guests send input and receive
media over WebRTC. Therefore Kickstart validation belongs on the host, and no Kickstart bytes,
paths or handles belong in room signalling.

Room persistence currently stores only system, player limit and current game name. Runtime
local releases are kept in the in-memory `runtimeFileRegistry.js`, then consumed by
`RoomPage.jsx`. A versioned Amiga manifest will travel through that existing runtime record and
host data channel; the database does not need ROM-related columns.

## Generated OpenRetro data

`Amiga.sqlite` remains a read-only build input and is never served. The importer
`scripts/import-openretro-amiga.py` opens it with SQLite `mode=ro`, decodes binary UUIDs,
handles zlib-compressed JSON and malformed rows, and emits deterministic compact JSON into
`frontend/public/data/amiga`. Artwork, screenshots, archives and games are excluded. The
browser fetches the hash index once and caches scan results in the existing IndexedDB.

Regenerate from `frontend` with `npm run data:amiga`. Generated files are:

- `openretro-games.json`: canonical metadata and configuration.
- `openretro-releases.json`: release-shard manifest; UUID-prefix shards contain variants with
  ordered media hashes and are loaded only after identification.
- `openretro-hash-index.json`: small manifest for two-hex-character hash shards under
  `hashes/`; each shard maps SHA-1 to release, parent, name and position. A scan fetches and
  caches only the prefixes it encounters rather than downloading the complete database.
- `openretro-config-index.json`: compact original FS-UAE configuration values.

## Planned integration and exact files

New focused modules will live in `frontend/src/features/amiga`: OpenRetro lookup and ZIP
inspection, typed runtime shapes, override application, configuration resolution, Kickstart
catalogue/scanner, PUAE translation and launch-manifest generation. Tests will sit beside those
modules and use generated fake fixtures only. `frontend/src/data/amigaOverrides.js` will hold
reviewable manual overrides.

Existing files to change are `frontend/package.json`, `frontend/src/localLibraryDb.js`,
`frontend/src/pages/LocalLibraryPage.jsx`, `frontend/src/features/localLibrary/core/scanner.js`,
`frontend/src/features/localLibrary/core/group.js`,
`frontend/src/features/localLibrary/services/localGameLaunchAdapter.js`,
`frontend/src/features/localLibrary/storage/runtimeFileRegistry.js`, `frontend/src/pages/RoomPage.jsx`,
`frontend/public/amiga-aga/launcher.html`, and, only where the selected profile uses vAmiga,
`frontend/public/amiga/launcher.js`. Backend room IDs remain accepted for compatibility.

## Resolver and launch rules

Configuration precedence is manual release override, release configuration, canonical parent
configuration, format/model inference, then the existing safe default. A single translator maps
the internal profile to options verified against the bundled PUAE core. Unsupported OpenRetro
keys are retained in diagnostics. The launch requirement names a catalogue Kickstart ID; the
browser matches SHA-1, obtains the local `File`, and supplies bytes only to the local iframe.
Missing ROMs or disks stop launch with an actionable diagnostic.

The bundled PUAE wrapper currently supports A1200, ordered M3U media and runtime disk index
changes. Its core options are presently hard-coded, and the vAmiga A500 path is a different
emulator rather than EmulatorJS/PUAE. The integration must make the PUAE options dynamic and
prove each translated option against the bundled core report/source; options not exposed by
that build will be reported, not claimed as applied.
