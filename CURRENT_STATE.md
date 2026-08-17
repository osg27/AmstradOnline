# Current State Snapshot

Snapshot time: 2026-08-17 (Europe/London)

## Git

- Branch: `main`
- Commit: `d0405dfd290da43640b8b7ebd1df31e4efbba546` (`Restore admin-created tournaments with retained ROMs`)
- Working tree at audit start: dirty.
- Pre-existing tracked changes: `.claude/settings.local.json`; Python bytecode under `backend/app/**/__pycache__`; many generated `frontend/dist/**` emulator/runtime/build files.
- Pre-existing untracked items: root `hi2txt-xml/`; `keropi/.keep`, `keropi/config`, `keropi/sram.dat`.
- Audit-created files: `PROJECT_MAP.md`, `REPO_STRUCTURE.md`, `TECH_DEBT.md`, `CLEANUP_CANDIDATES.md`, `AI_HANDOVER.md`, `FEATURE_INDEX.md`, `CURRENT_STATE.md`, `LOCAL_BUILD_MAP.md`, and `LOCAL_WORKSPACE.md`.
- Workspace cleanup: `.gitignore` now excludes the root `hi2txt-xml/` checkout and mutable keropi state. All 224 legacy tracked `frontend/dist/` paths and 11 tracked Python bytecode files are staged for index removal with their local files preserved.

## Verification

### Frontend tests

- Command: `npm test` from `frontend/`
- Status: PASS
- Result: 9 files passed, 104 tests passed, 0 failed.
- Warnings: Vitest/Vite React plugin reports deprecated `esbuild` and `optimizeDeps.esbuildOptions` options in favor of oxc/rolldown options; both esbuild and oxc options are set.

### Frontend production build

- Command: `npm run build` from `frontend/`
- Status: PASS
- Result: Vite 5.4.21 transformed 101 modules and built successfully in about 5 seconds.
- Warning: main JavaScript chunk was 1,448.69 kB minified / 345.37 kB gzip, above Vite's 500 kB warning threshold.

### Backend tests

- Command: `python -m pytest -q` from `backend/`
- Status: NOT RUN / environment failure
- Result: `No module named pytest`; collection did not begin.
- Existing test files: `backend/tests/test_mame_high_scores.py`, `backend/tests/test_amiga_high_scores.py`.
- Packaging issue: `pytest` is not in `backend/requirements.txt` and no separate dev/test requirements file exists.

### Lint/type checks

- Status: NOT AVAILABLE.
- Evidence: no frontend lint script and no backend lint/type-check configuration was found.

## Known Failures and Warnings

- Backend test command cannot run in the declared environment due to missing pytest.
- Vite/Vitest configuration compatibility warnings.
- Oversized frontend entry chunk.
- Every frontend build dirties tracked `frontend/dist` artifacts.
- Importing/running backend code can dirty tracked Python bytecode.

## Known Bugs / Risks

See `TECH_DEBT.md`. Highest-risk known limitations are unauthenticated single-process signaling; absent TURN; startup-time ad-hoc migrations/data corrections; incomplete ROM/emulator licensing provenance; upload/storage hardening gaps; no CI/backend API coverage; and development-oriented deployment.

## Unfinished or Unverified Features

- Achievements: no implementation found.
- Payments/subscriptions: no implementation; VIP is tester/preview access.
- Production TURN/reliable NAT traversal: absent.
- Complete production nginx/TLS/backups/monitoring/rollback: not present in repository.
- Dreamcast and pinball public runtimes: exposure and readiness unknown.
- Emulator system/version/licensing inventory: incomplete.
- Backend route/auth/social/tournament integration test coverage: largely absent.

## Features Believed Production-Ready

None are marked production-ready. Frontend unit tests and build pass, but repository evidence does not include end-to-end browser/emulator/multiplayer testing, runnable backend tests, security/load testing, production deployment verification, backup/restore proof, TURN, monitoring, or licensing clearance.

## Features With Positive Repository Evidence (not a production-readiness claim)

- React application compiles successfully.
- Controller/local-library/Amiga frontend helper tests pass (104 total tests across 9 files).
- Implementations exist for auth/recovery, rooms, WebRTC signaling/streaming, social/DMs, local library/artwork, multiple emulators, general/MAME/Amiga scores, tournaments, feedback, admin, tester/VIP preview access, voice and OBS capture view.
