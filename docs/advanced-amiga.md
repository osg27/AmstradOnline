# Advanced Amiga investigation and implementation

## M1: existing architecture

React 18/Vite, FastAPI, SQLAlchemy/PostgreSQL, JWT. Administrator policy is `admin.require_admin`, based on the persisted user and existing role/username policy. API paths use `/auth/admin` so existing production `/auth` proxying applies.

`RoomPage.jsx` selects the existing `/amiga-aga/launcher.html` dedicated PUAE player for Amiga models; the repository also retains vAmiga and EmulatorJS assets. The player instantiates `EJS_Runtime` from `/puae-wasm/puae_libretro.js`, writes Kickstarts, floppies or extracted WHDLoad content into Emscripten FS, writes RetroArch core options and calls `callMain`. It already bridges keyboard, mouse, controllers, disk selection, audio capture and high-score extraction. Room recording uses the existing capture adapters. Those room paths are preserved.

The checked-in build source is `puae-wasm-build/compile/puae`; no reproducible provenance binding its exact revision to the deployed WASM was found. Source support is evidence of a capability, not proof of a deployed browser boot. `libretro/libretro-core.c` reads `.uae` content, supports `filesystem2` directory volumes and `hardfile2` images, including RDB detection. Hardware overrides must be automatic when custom UAE configuration is loaded, or the loader skips hardware rows. Chip memory units are 512 KiB; slow memory units are 256 KiB. Z2 fast memory is limited to 8 MiB; 16/32 MiB must use Z3 and a 32-bit CPU/address space.

The bundled JS exposes FS, callMain, pause/resumeMainLoop, save-state and input functions. It does not expose an acknowledged UAE hard-drive flush/close operation. `_cmd_savefiles` handles RetroArch save RAM and is not proof that UAE hard-drive caches are flushed. Existing WHDLoad quit-key saving is not a general Workbench hard-drive shutdown. MEMFS alone is volatile.

Library artwork storage (`library_media`) is public and is unsuitable for private Workbench data. Game sources are account-linked remote catalogues, not a trusted local installed-games directory. Advanced storage therefore uses a separate private backend storage root. Server folder selection is confined to its `library` child; operators must copy approved installed-game folders there. No arbitrary existing filesystem root is exposed.

## Smallest safe changes

Add a protected private resource API, validated profiles and bounded private uploads; add an administrator page in the existing application; reuse the dedicated player with an optional advanced launch adapter. Generate UAE configuration server-side and resolve opaque resource identifiers. Import local folders as private copies with relative filenames; mount those copies through `filesystem2`, not a ZIP download. Read-only source images prevent concurrent sessions corrupting originals.

## Verification boundary

Writable disks, blank-disk creation and Workbench installation are disabled pending an acknowledged core flush/close bridge and end-to-end persistence tests. Profile persistence and private source-file persistence do not save guest writes. Workbench desktop boot, volume appearance, executable launch and hardware behaviour require legitimate administrator media and browser verification. These are not claimed as passed.

References inspected: https://docs.libretro.com/library/puae/ , https://emulatorjs.org/docs/systems/commodore-amiga/ , https://emscripten.org/docs/porting/files/file_systems_overview.html . The local source and exported runtime API take precedence over upstream feature lists.

## Administrator workflow and deployment

Open **Admin dashboard ? Advanced Amiga** (`/admin/amiga`). Import a compatible Kickstart ROM and an existing bootable HDF. Select RDB for an RDB image; choose manual geometry for a non-RDB image using its original geometry. The A1200 Workbench preset uses 68020, AGA, 2 MiB Chip, 8 MiB Fast and zero Slow RAM. Save the profile and Start Workbench. Sources are fetched using the existing bearer token, never by unrestricted static URL. Stop Amiga discards the read-only runtime. Fullscreen, keyboard/mouse and core input use the existing player; room recording and multiplayer remain on the existing room path.

Mount Local Folder uses the browser directory chooser to import a private server copy. ZIP is only the bounded upload transport: the backend extracts validated filenames, and the player writes files into MEMFS and supplies `filesystem2` UAE volume directives. It is not live access to Windows paths. Mount Server Folder lists immediate children of the private `library` directory and takes an immutable snapshot. Neither operation claims a successful guest mount solely from successful import. Boot priority -128 excludes a drive from boot selection.

Default private storage is `backend/storage/advanced-amiga` (container `/app/storage/advanced-amiga`). Override with `ADVANCED_AMIGA_STORAGE` if needed. Keep it outside all web/static roots and include it in backups. Existing Docker backend bind mounting persists this directory. Approved server game folders go under its `library` child; the repository's account-linked URL game sources are not local folders and are not imported automatically. This intentionally avoids inventing or exposing a production filesystem location. Import cap: 128 MiB and 4096 entries, mounted source cap: 256 MiB, catalogue quota: 2 GiB. Symlink/junction entries and case aliases are rejected. Operators must control storage directory writes while snapshots are taken.

Profiles are shared administrator resources stored transactionally in the private catalogue. New, save/rename, duplicate, delete and default flags are supported. Source files are persistent private copies. Profiles contain opaque asset IDs, never local OS paths or ROM bytes. The launch endpoint builds UAE text from a strict schema; arbitrary UAE text and writable modes are rejected. Changing browser code cannot bypass backend administrator checks.

## Outstanding acceptance work

M2/M3/M4/M5 have a protected implementation path, but functional acceptance is **not complete**. No administrator Workbench/Kickstart media were supplied for desktop boot, executable launch, actual mounted-volume confirmation, or hardware probes. No end-to-end emulator regressions are claimed. Writable HDF installation/persistence and disk creation remain unavailable. To enable them safely, expose a core stop/close/flush acknowledgement, test cached guest writes reaching the backing FS, then add atomic versioned disk commits and cross-session writer leases; save RAM/state calls are insufficient. Do not enable write controls based on source inspection alone.
