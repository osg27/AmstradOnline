# Local Emulator Build Map

Audit date: 2026-08-17. This maps the current local machine, not a portable/reproducible build manifest. `UNKNOWN` means no reliable build/copy evidence was found. Nested repositories are intentionally left at their current paths because several contain unique work and two tracked build scripts use those paths by default.

## Top-Level Classification

| Path | Classification | Purpose / evidence |
|---|---|---|
| `.git/` | PRODUCT SOURCE metadata | Old Style Gaming Git database. |
| `.agents/`, `.claude/` | LOCAL DEVELOPMENT DATA | AI/developer tool configuration; `.claude/settings.local.json` is tracked and locally modified. |
| `.vscode/` | LOCAL DEVELOPMENT DATA | Ignored editor state. |
| `backend/`, `frontend/`, `scripts/`, `docs/` | PRODUCT SOURCE | Application, build/maintenance scripts and documentation. |
| Root Markdown files | PRODUCT SOURCE | Project maps, handover and operating documentation. |
| `.env.example`, `.gitignore`, `docker-compose*.yml` | PRODUCT SOURCE/configuration | Versioned templates and development infrastructure. |
| `.env` | LOCAL DEVELOPMENT DATA | Ignored secret-bearing configuration; never commit. |
| `frontend/public/` | PRODUCT RUNTIME ASSET | Source-of-truth runtime files copied into `frontend/dist` by Vite. |
| `frontend/dist/` | BUILD OUTPUT | Vite output. Deployment rebuilds it with `npm run build`; now removed from Git tracking but retained locally. |
| `library_media/` | LOCAL DEVELOPMENT DATA | Ignored server artwork/media cache; currently empty. |
| `amstrad_controls/` | GENERATED DATA | 666 generated CPC controller-profile JSON files; ignored; source/generator provenance is UNKNOWN. |
| `Amiga.sqlite`, `CD32.sqlite`, `CDTV.sqlite`, `Files.sqlite` | LOCAL DEVELOPMENT DATA | Ignored OpenRetro/import databases. `Amiga.sqlite` is the default input for `npm run data:amiga`. |
| `cgrom.dat`, `iplrom.dat`, `keropi/` | FIRMWARE / runtime state | X68000 firmware is tracked at root and partly duplicated in tracked `keropi/`; `keropi/config`, `sram.dat`, `.keep` are local mutable state and now ignored. Licensing/duplication requires investigation. |
| `fceumm-wasm-patched.data` | BUILD OUTPUT | Ignored patched NES core data; production copy is `frontend/public/emulatorjs/data/cores/fceumm-wasm.data`. Exact generating command is UNKNOWN. |
| `fceumm-verify/` | TEMPORARY / BUILD OUTPUT | Ignored single-file verification output (`fceumm_libretro.js`). |
| `EmulatorJS/`, `MameWasm/`, `mamejs/`, `vAmigaWeb/`, `vice.js/`, `vice32.js/`, `flycast-wasm/`, `wasm-genplus/`, `zpz/`, `beetle-pce-fast-libretro/`, `hi2txt-xml/` | THIRD-PARTY SOURCE | Nested Git checkouts described below. |
| `puae-wasm-build/` | THIRD-PARTY SOURCE / BUILD OUTPUT | EmulatorJS build checkout plus nested PUAE and RetroArch checkouts and compiled output. |

## Amstrad CPC (`zpz` experimental runtime)

- Runtime used by site: `frontend/public/emulator/zpz6128.wasm`; a duplicate experimental pinball shell uses `frontend/public/emulator-pinball/zpz6128.wasm`.
- Source/build workspace: `zpz/`.
- Upstream: `https://github.com/jdmichaud/zpz.git`.
- Branch/commit: `master`, `e54d51d499b386385215365a295dab33e6a60213`.
- Dirty: yes.
- Modified: `build.zig`, `chips` submodule pointer/worktree, `src/zpz-native.zig`, `src/zpz-wasm.zig`, `src/zpz.zig`.
- Untracked: `compat/` and four named local/global Zig cache experiments (`.zig-cache-*-fix`, `.zig-global-cache-*-fix`). Normal `.zig-cache`/`zig-out` output is also present but ignored internally.
- Local-patch classification: **CRITICAL**. A cache output at `.zig-cache-caps-fix/.../zpz6128.wasm` hashes exactly to the production runtime. Parent changes and the dirty `chips` checkout must be preserved.
- Build command: upstream `zig build`; the exact command/options producing the matching cache artifact are not documented.
- Copied output: matching artifact -> `frontend/public/emulator/zpz6128.wasm`. Copy process is manual/UNKNOWN.
- Safe to rebuild: **NO** until the matching caps-fix build and submodule patch are captured in a reproducible script/commit.

The `zpz/chips` submodule is at recorded commit `6142db03ca34d742925ee3d23b6408e9d5f4729b`, but Git inspection is blocked by a Windows ownership/safe-directory warning. Do not reset or replace it.

## Amstrad CPC (`CPCBox` production runtime)

- Runtime: `frontend/public/emulator-cpcbox/`.
- Source/build workspace: `MameWasm/` is the only large local MAME-family tree with CPC-related potential, but a definitive source-to-CPCBox link was not found.
- Local patches: none reported by the `MameWasm` parent Git checkout.
- Build command/output provenance: **UNKNOWN**.
- Safe to rebuild: **UNKNOWN**.

## MAME / EmulatorJS

- Runtime: `frontend/public/arcade/` and `frontend/public/emulatorjs/`; MAME core data includes `mame2003_plus-*-wasm.data`.
- Source/build workspaces: `EmulatorJS/`, `MameWasm/`, and `mamejs/`.

### EmulatorJS

- Upstream: `https://github.com/EmulatorJS/EmulatorJS.git`.
- Branch/commit: `main`, `20545cff55c8dac370a93559ced6f86e78051683` (`v4.3.0-pre-1-g20545cf`).
- Dirty: yes; `data/cores/package.json` is modified.
- Untracked: none.
- Likely purpose: downloaded/built core package metadata and the runtime loader/source copied into `frontend/public/emulatorjs/`.
- Local-patch classification: **IMPORTANT/UNKNOWN**. Preserve until the package manifest change is understood; Git reports it dirty even though the content diff appears dominated by line-ending normalization.
- Build process: upstream `package.json`/`build.js`; no Old Style Gaming copy/update script exists.
- Safe to rebuild: **NO** until copy provenance and the manifest change are documented.

### MameWasm

- Upstream: `https://github.com/anomixer/MameWasm.git`.
- Branch/commit: `main`, `5d60081183135001ee8b4d5f59b1d55e8340fbef`.
- Dirty: no parent-tree modifications/untracked files reported.
- Size: approximately 4.6 GB / 63,000 files, indicating a full source/build workspace.
- Likely purpose: experimental/native MAME WebAssembly build.
- Build docs: `README.md`, `build.ps1`, `build-linux.ps1`.
- Copied output: exact production mapping **UNKNOWN**.
- Safe to rebuild: **UNKNOWN**; source is clean, but output procedure is not tied to the site.

### mamejs

- Upstream: `https://github.com/ybootin/mamejs.git`.
- Branch/commit: `master`, `7ba5a98b31424223ac89fd912923f22937c3e1d6`.
- Dirty: clean; submodule `mame` is recorded but not initialized (`-e2641a...`).
- Build: `npm run build` creates `dist/mamejs.js` and CSS.
- Runtime produced: no matching active site runtime was proven; likely an abandoned MAME experiment.
- Safe to rebuild: **YES as upstream**, but relevance to production is **UNKNOWN**.

## C64 / VICE

- Runtime: `frontend/public/c64/c64.js`, `c64.wasm`, `launcher.html`, `launcher.js`.
- Primary source/build workspace: `vice.js/`.
- Upstream: `https://github.com/rjanicek/vice.js.git`.
- Branch/commit: `master`, `9b3e5f21489f96967d649790d3c915ac3127c6ec`.
- Dirty: tracked tree clean, but it contains untracked `vice-2.4.tar.gz` and a large configured/patched/built `vice-2.4/` source tree.
- Local-patch classification: **CRITICAL**. The untracked extracted source contains the configured source and object files required by the product build script and may contain edits not represented in the parent repository.
- Build command: `powershell -ExecutionPolicy Bypass -File scripts/build-vice-wasm.ps1`. Optional `-EmsdkPath` and `-ViceJsPath` parameters are supported.
- Copied output: the script currently writes `frontend/public/c64/vice.js` and `vice.wasm`, but the checked-in runtime is named `c64.js` and `c64.wasm`. The rename/copy step is undocumented, so running the script alone does not reproduce the deployed filenames.
- Hard-coded/default paths: defaults to root `vice.js/`, local `C:\Users\pagma\Desktop\Repos\emsdk`, and `C:\msys64\usr\bin\bash.exe`.
- Safe to rebuild: **NO** until `vice-2.4/` local patches/configuration are separately inventoried and backed up.

Secondary clean checkout: `vice32.js/`, upstream `https://github.com/Sgeo/vice32.js.git`, branch `master`, commit `c4295b18c87007ddc1f11ed6611b27d6afefa7f7`. It has no local changes and may be a discarded alternative; output mapping is UNKNOWN.

## Mega Drive / Master System

- Runtime: `frontend/public/megadrive/genplus.js`, `genplus.wasm`, launcher files.
- Source/build workspace: `wasm-genplus/`.
- Upstream: `https://github.com/h1romas4/wasm-genplus`.
- Branch/commit: `master`, `6090aff9e9b2f578cd28882bd4571d2e35b1d674`.
- Dirty: yes.
- Modified: `CMakeLists.txt`, `src/main/c/wasm/config.c`, `fileio.c`, `wasm.c`, `src/main/js/genplus.js`, `genplus.wasm`.
- Untracked: none.
- Local-patch classification: **CRITICAL**. Both modified `src/main/js/genplus.js` and `genplus.wasm` hash exactly to the files used by the site.
- Build: upstream CMake/npm project; exact local command and toolchain are not captured in Old Style Gaming scripts.
- Copied output: `wasm-genplus/src/main/js/genplus.{js,wasm}` -> `frontend/public/megadrive/`.
- Safe to rebuild: **NO** until the six-file patch is committed/exported and build command/toolchain are recorded.

## Amiga / vAmiga

- Runtime: `frontend/public/amiga/`, notably `vAmiga.js` and `vAmiga.wasm`.
- Source/build workspace: `vAmigaWeb/`.
- Upstream: `https://github.com/vAmigaWeb/vAmigaWeb.git`.
- Branch/commit: `main`, `c3c50d90f3c07e8fadb49bd11cd49ea1525a2c69`.
- Dirty: yes. Git reports `CMakeLists.txt`, `Core/CMakeLists.txt`, three serial/remote-server source files, and `main.cpp`; substantive diff was visible in the two CMake files, while remaining reports may include line-ending/stat changes.
- Untracked: none.
- Local-patch classification: **IMPORTANT**. Preserve all six reported paths until serial/linking intent is confirmed.
- Build output: `vAmigaWeb/build/vAmiga.js` and `.wasm` hash exactly to `frontend/public/amiga/vAmiga.js` and `.wasm`.
- Build: CMake project; exact local configure/build/copy command is not captured in this repository.
- Safe to rebuild: **NO** until the dirty state and toolchain are preserved/documented.

## Amiga AGA / PUAE

- Runtime: `frontend/public/puae-wasm/puae_libretro.js` and `.wasm`; `frontend/public/amiga-aga/launcher.html`.
- Source/build workspace: `puae-wasm-build/`.
- Outer upstream: `https://github.com/EmulatorJS/build.git`, branch `main`, commit `7f4d2d7354d7b25766bf5229f8a5c4b121515a68`, clean.
- Nested clean repositories: `compile/puae` at `063af5822129135c51b42c50522b71c8a01797dc` from `EmulatorJS/libretro-uae`; `compile/RetroArch` at `5a21e08a5de7649cfa6416d6843c0c40de27714e` from `EmulatorJS/RetroArch`.
- Build command: `powershell -ExecutionPolicy Bypass -File scripts/build-puae-wasm.ps1`.
- Copied output: script copies RetroArch `puae_libretro.js/.wasm` to `frontend/public/puae-wasm/`.
- Hard-coded/default paths: root `puae-wasm-build/`, local emsdk/MSYS paths and fixed Emscripten Node/Python versions.
- Local patches: none currently reported in the three Git worktrees.
- Safe to rebuild: **YES on this machine**, subject to the hard-coded toolchain remaining installed; pinning/toolchain documentation should be improved.

## PC Engine

- Runtime: `frontend/public/emulatorjs/data/cores/mednafen_pce-*-wasm.data`; launcher `frontend/public/pcengine/`.
- Source workspace: `beetle-pce-fast-libretro/`.
- Upstream: `https://github.com/libretro/beetle-pce-fast-libretro.git`.
- Branch/commit: `master`, `cad58cb0efed50ebf0ffa18f3b76748a45cbef28`.
- Dirty: clean.
- Build: upstream Makefile; exact Emscripten/EmulatorJS packaging and copy steps are UNKNOWN.
- Safe to rebuild: **UNKNOWN**.

## NES

- Runtime: `frontend/public/nes/` for jsnes and `frontend/public/emulatorjs/data/cores/fceumm-wasm.data` for EmulatorJS paths.
- Verification/build material: ignored `fceumm-verify/fceumm_libretro.js` and root `fceumm-wasm-patched.data`.
- Source repository: none identified locally for fceumm; jsnes arrives via npm plus a copied public build.
- Local patches: patched `.data` strongly implies unique work, but generating source/command is **UNKNOWN**.
- Classification: `fceumm-wasm-patched.data` is **IMPORTANT** until its relationship to the production core is recorded.
- Safe to rebuild: **NO/UNKNOWN**.

## Dreamcast / Flycast

- Runtime used by site: no files currently exist in `frontend/public/dreamcast/`; EmulatorJS contains `flycast-wasm.data`, but the main UI does not expose Dreamcast.
- Source workspace: `flycast-wasm/`.
- Upstream: `https://github.com/nasomers/flycast-wasm.git`.
- Branch/commit: `main`, `85b1be525d01f33f2debdb5a5636e85f856c6097`.
- Dirty: yes; `demo/server.js` has one local change.
- Untracked: `demo/server.err.log`, `demo/server.out.log`, `flycast/`, and `pkg-local/` containing build metadata and JS/WASM/data output.
- Local-patch classification: **EXPERIMENTAL/IMPORTANT**. The output is not currently deployed through `frontend/public/dreamcast`, but preserve it until the experiment is consciously archived.
- Build command: upstream README; local exact build invocation UNKNOWN.
- Safe to rebuild: **UNKNOWN**.

## hi2txt

- Runtime data: tracked `backend/app/data/hi2txt-xml/`; external executable/JAR is configured separately.
- Local source/data checkout: `hi2txt-xml/`.
- Upstream: `https://github.com/GreatStoneEx/hi2txt-xml.git`.
- Branch/commit: `master`, `990fca26edb8cd9e37ab0b569d5d59b06e31f0e0` (`2020-05-02-22-g990fca2`).
- Dirty: clean.
- Build: Gradle wrapper/project.
- Used by: `scripts/generate_mame_tournament_hi_templates.py` can default to its test inputs; backend can discover it by configured path. The production-safe definition copy remains tracked under backend data.
- Safe to rebuild: **YES as upstream**, but copying/updating backend definitions should be reviewed as a data change.

## Other Site Runtimes Without Local Source Mapping

The following required runtime assets exist under `frontend/public/`, but no conclusive local build-source mapping or reproducible Old Style Gaming build script was found: Atari 8-bit, Atari ST/Hatari, PlayStation/PCSX ReARMed, Saturn/Yabause/Beetle, SNES/Snes9x, Spectrum/JSSpeccy, Sharp X68000/PX68K, and portions of EmulatorJS core packaging. Do not replace these assets based only on a similarly named local checkout.

## Proposed Directory Structure

Conceptually, future clean machines should use:

```text
OldStyleGaming/
  backend/ frontend/ scripts/ docs/       # product repository
  frontend/public/                         # versioned runtime assets

OldStyleGaming-workspaces/
  upstream/                                # nested third-party Git repositories
  build-work/                              # compiled objects/caches/extractions
  local-data/                              # SQLite imports, generated profiles, media cache
  firmware/                                # legally cleared source firmware copies
```

This audit did **not** move existing trees. Reasons:

1. `vice.js/`, `wasm-genplus/`, `vAmigaWeb/`, `zpz/`, `EmulatorJS/`, and `flycast-wasm/` contain unique or unresolved work.
2. VICE and PUAE scripts default to their existing root-relative paths.
3. Several output copy processes are manual/unknown.
4. Moving roughly 6.8 GB of repositories/build output adds recovery risk without reducing `git status`, because these paths can be ignored safely in place.

After patches are committed or exported and build scripts accept configurable workspace roots, these directories can be moved in small per-emulator batches while retaining their `.git` directories.
