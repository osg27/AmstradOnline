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

Default private storage is `backend/storage/advanced-amiga` (container `/app/storage/advanced-amiga`). Override with `ADVANCED_AMIGA_STORAGE` if needed. Keep it outside all web/static roots and include it in backups. Existing Docker backend bind mounting persists this directory. Approved server game folders go under its `library` child; the repository's account-linked URL game sources are not local folders and are not imported automatically. This intentionally avoids inventing or exposing a production filesystem location. Import cap: 1 GiB per HDF; folders and other media remain capped at 128 MiB with 4096 folder entries. Mounted source cap: 1152 MiB; catalogue quota: 2 GiB. Large HDFs require sufficient browser memory. The advanced player hands media buffers to MEMFS without an additional full copy. Symlink/junction entries and case aliases are rejected. Operators must control storage directory writes while snapshots are taken.

Profiles are shared administrator resources stored transactionally in the private catalogue. New, save/rename, duplicate, delete and default flags are supported. Source files are persistent private copies. Profiles contain opaque asset IDs, never local OS paths or ROM bytes. The launch endpoint builds UAE text from a strict schema; arbitrary UAE text and writable modes are rejected. Changing browser code cannot bypass backend administrator checks.

## Outstanding acceptance work

M2/M3/M4/M5 have a protected implementation path, but functional acceptance is **not complete**. No administrator Workbench/Kickstart media were supplied for desktop boot, executable launch, actual mounted-volume confirmation, or hardware probes. No end-to-end emulator regressions are claimed. Writable HDF installation/persistence and disk creation remain unavailable. To enable them safely, expose a core stop/close/flush acknowledgement, test cached guest writes reaching the backing FS, then add atomic versioned disk commits and cross-session writer leases; save RAM/state calls are insufficient. Do not enable write controls based on source inspection alone.

## Large HDF upload deployment

The VPS deployment script now sets the nginx HTTP upload ceiling to `1100m`; the protected API still enforces 1 GiB for HDFs and the smaller limits for other media. Run the normal deployment script with its nginx configuration write access, or set `client_max_body_size 1100m;` in the existing `/auth/admin/amiga/` proxy location and validate/reload nginx. A more specific server/location limit overrides the script's HTTP default. The importer displays upload percentage, waits for server confirmation, and reports HTTP 413 explicitly. Successful imports are added to the current profile immediately, without depending on another catalogue request. This raises media size limits only; guest-write persistence remains disabled.

## Local HDFs without upload

Use **Use Local HDF (no upload)** to select a local image. Selection reads only the first 8 KiB to identify an RDB header; starting PUAE reads the full disk into browser MEMFS. Non-RDB images expose manual geometry that must match the source setup. The protected profile/launch API stores only the filename, size and validated drive settings for local media, never its contents or a Windows path. The local image has no server file URL. On refresh or a later visit, use **Choose file** on the corresponding drive row to reselect the same name and size; this is not a cryptographic identity check. Local disks remain read-only and writes do not persist. Kickstart still uses the existing protected ROM selection.

Uploads now have a **Cancel upload** button and a 15-minute request timeout. A displayed percentage measures request bytes sent, not emulator loading or proof of a completed import. Local HDF selection avoids that transfer entirely. Tests cover local profile generation with no stored HDF data, bounded header inspection, cancellation and timeout errors. Workbench boot with a real administrator disk still requires manual verification.

## Local software folders without upload

Select **Use Local Folder (no upload)** and choose the Software directory. Its files remain on the PC until Start Workbench reads them into a read-only MEMFS copy; the generated UAE `filesystem2` entry exposes that copy as an Amiga volume. Relative hierarchy and filenames are retained and case aliases/traversal rejected before reading content. The profile stores only folder name, aggregate size, file count and validated mount settings. No folder file list, file contents or local OS path is sent to the API. After refreshing, use **Choose folder** on the saved drive row; reselecting checks name, byte count and file count, not a cryptographic identity. Browser directory input supplies files, so empty-only directories are not represented. Local folders are capped at 512 MiB/20,000 files and share the 1152 MiB mounted-source budget with HDFs. **Upload Folder (server copy)** is a separate, explicit action.

Automated verification covers hierarchy preservation without reading file contents during selection, filename/size/count validation, protected profile/launch generation with `filesystem2`, and absence of server folder data. Actual guest executable launch remains a manual verification requirement.
