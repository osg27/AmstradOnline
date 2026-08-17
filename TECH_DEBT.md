# Technical Debt Register

Audit date: 2026-08-17. “Before monetisation” means before accepting payment for access to this service, not merely before further private testing.

## Critical

### Unauthenticated, unbounded, process-local signaling

- Problem: `backend/app/websockets/signaling.py` accepts any connection knowing a room code, relays arbitrary JSON, has no connection/message/rate limits, and stores all peers in one process memory map.
- Affected files: `backend/app/websockets/signaling.py`, `frontend/src/hooks/useSignaling.js`, `frontend/src/pages/RoomPage.jsx`.
- Why it matters: room interception/abuse is possible; one malformed/slow peer can destabilize relay; multiple workers cannot share state and restarts drop all signaling.
- Recommended solution: authenticate WebSocket upgrade with a short-lived room-scoped token; validate message schemas/size; impose limits; add disconnect/error isolation; use Redis/pub-sub or deliberately enforce a single signaling worker; add tests.
- Change risk: high because it affects every multiplayer connection.
- Before monetisation: yes.

### No TURN service or demonstrated production WebRTC connectivity

- Problem: compose and deployment contain no coturn/TURN credentials or health checks.
- Affected files: `frontend/src/utils/webrtc.js`, `frontend/src/pages/RoomPage.jsx`, `docker-compose.yml`, deployment configuration outside repository.
- Why it matters: peers behind restrictive/symmetric NATs will fail unpredictably, making a paid multiplayer product unreliable.
- Recommended solution: deploy authenticated TURN over UDP/TCP/TLS, configure ICE servers through environment-backed public configuration, monitor relay use, and test representative networks.
- Change risk: medium/high operational risk.
- Before monetisation: yes.

### Startup code performs ad-hoc destructive data corrections

- Problem: `ensure_runtime_columns()` runs schema DDL and hard-coded production user score delete/update statements on every application start.
- Affected files: `backend/app/core/migrations.py`, `backend/app/main.py`.
- Why it matters: startup can mutate/delete customer data; migrations are not versioned, transactional history is unclear, concurrency can race, and rollback/audit is absent.
- Recommended solution: introduce Alembic, capture the current schema as a baseline, migrate each conditional DDL once, and move data corrections into reviewed one-time migrations with backups.
- Change risk: high.
- Before monetisation: yes.

### ROM/firmware distribution and emulator licensing are not evidenced centrally

- Problem: restricted remote ROM/firmware endpoints, catalogue names, tracked firmware, and many vendored emulator builds exist without a single licence/provenance inventory.
- Affected files: `backend/app/api/routes/auth.py`, `backend/app/data/*_vip_catalog.json`, `frontend/public/**`, root/`keropi/*.dat`.
- Why it matters: charging for access can materially increase copyright, ROM-distribution, firmware, GPL/source-offer, attribution, and trademark exposure.
- Recommended solution: obtain specialist legal review; inventory every runtime/data asset with source, version, license, modifications and distribution basis; remove access to anything not cleared.
- Change risk: high if assets are replaced, low for the audit itself.
- Before monetisation: yes.

### No payment/subscription system exists

- Problem: “VIP”/tester access is a role/username allowlist, not billing, entitlement lifecycle, invoicing, refunds, tax, webhook verification, or customer support tooling.
- Affected files: `backend/app/api/routes/auth.py`, `backend/app/core/config.py`, `backend/app/core/migrations.py`, `frontend/src/vipMameCache.js` and role checks.
- Why it matters: manually granting roles cannot safely represent paid entitlements and creates fraud/support/accounting risk.
- Recommended solution: design a separate payment/entitlement domain after legal/licensing decisions; use a reputable provider; verify signed idempotent webhooks; never infer payment from role alone.
- Change risk: high/new feature.
- Before monetisation: yes.

## High

### Backend is effectively untested in the declared environment

- Problem: tests exist, but `pytest` is absent from `backend/requirements.txt`; running `python -m pytest -q` fails before collection. Most APIs have no tests.
- Affected files: `backend/requirements.txt`, `backend/tests/`, all route modules.
- Why it matters: authentication, deletion, social, room, tournament, upload and migration regressions can ship unnoticed.
- Recommended solution: create pinned development/test requirements, add database-isolated API/integration tests, and run them in CI.
- Change risk: low.
- Before monetisation: yes.

### No CI quality gate or lint/type-check command

- Problem: no tracked CI workflow was found; frontend has no lint script and backend has no formatter/linter/type-check config.
- Affected files: repository configuration, `frontend/package.json`, backend tooling.
- Why it matters: builds/tests depend on manual discipline and cross-assistant handovers can introduce inconsistent failures.
- Recommended solution: add CI for frontend tests/build and backend tests plus conservative linting; establish baselines before enforcing style rewrites.
- Change risk: low/medium.
- Before monetisation: yes.

### Monolithic room and library orchestration

- Problem: `frontend/src/pages/RoomPage.jsx` (~thousands of lines) and `LocalLibraryPage.jsx` combine UI, emulators, networking, media, storage and domain rules.
- Affected files: those pages and `frontend/src/styles.css`.
- Why it matters: small changes have wide regression surfaces, dependency arrays/state lifetimes are hard to reason about, and emulator behavior lacks isolation.
- Recommended solution: first add characterization tests; then extract one stable hook/adapter at a time without changing behavior.
- Change risk: high.
- Before monetisation: recommended for the highest-risk flows, not a wholesale rewrite.

### Upload/resource controls need a security review

- Problem: box art, tournament ROMs, and score-save uploads write/read server files; safety depends on scattered extension/name/path/size checks.
- Affected files: `backend/app/api/routes/library_media.py`, `tournaments.py`, `mame.py`, score services, `auth.py` download endpoints.
- Why it matters: path traversal, storage exhaustion, decompression bombs, malicious content serving, and unauthorized enumeration are common paid-service attack paths.
- Recommended solution: threat-model every upload/download; centralize safe filenames/path containment; cap request/file/decompressed sizes; isolate storage; scan where appropriate; add adversarial tests.
- Change risk: medium.
- Before monetisation: yes.

### Deployment is development-oriented and production topology is incomplete

- Problem: Compose installs dependencies at every start, source-mounts applications, runs Vite dev server, publishes PostgreSQL, and has no health checks/resource limits. Full nginx/TLS config is absent.
- Affected files: `docker-compose.yml`, `docker-compose.local.yml`, `scripts/deploy-vps.sh`, `README.md`.
- Why it matters: non-reproducible startup and exposed services can cause outages/security issues.
- Recommended solution: immutable pinned images, production static frontend, internal DB network, health checks, backups/restore drill, TLS/security headers, process/worker strategy, monitoring and rollback.
- Change risk: high operationally.
- Before monetisation: yes.

### Secrets/session security lacks automated validation and revocation design

- Problem: config accepts arbitrary JWT secret/algorithm; access tokens have no audience/issuer/token type; refresh records are account tokens with limited session-management UI; security headers/CSRF assumptions depend on deployment.
- Affected files: `backend/app/core/config.py`, `security.py`, `backend/app/api/routes/auth.py`, `.env.example`.
- Why it matters: weak configuration or token theft could compromise paid accounts.
- Recommended solution: fail fast on weak/default production secrets; constrain algorithm; add issuer/audience/jti; document cookie SameSite/HTTPS/CSRF model; expose session revocation; rate-limit auth/recovery.
- Change risk: medium/high due to session compatibility.
- Before monetisation: yes.

## Medium

### Generated output and bytecode tracking cleanup must be committed

- Problem: legacy `frontend/dist/**` and Python `__pycache__/*.pyc` were removed from the Git index during the workspace cleanup, but the staged removals and `.gitignore` change still need a reviewed commit.
- Affected files: `.gitignore`, staged generated/cache paths.
- Why it matters: until committed, other clones still track build output and bytecode.
- Recommended solution: review and commit the staged index cleanup. Deployment evidence is `scripts/deploy-vps.sh`, which runs `npm run build`; runtime source assets remain under `frontend/public/`.
- Change risk: low/medium; verify the next VPS deployment after committing.
- Before monetisation: no, but fix soon.

### README describes an obsolete starter state

- Problem: it says the embedded emulator and several features are absent, although many are now implemented.
- Affected files: `README.md`.
- Why it matters: developers begin from incorrect assumptions.
- Recommended solution: replace starter claims with a concise entry point linking these audit documents and verified run instructions.
- Change risk: low.
- Before monetisation: no.

### Runtime migrations duplicate model/schema knowledge

- Problem: table definitions live both in SQLAlchemy models and SQL strings in `core/migrations.py`.
- Affected files: `backend/app/models/*.py`, `backend/app/core/migrations.py`.
- Why it matters: drift and dialect inconsistencies are likely.
- Recommended solution: Alembic migration history generated/reviewed against models.
- Change risk: high during transition.
- Before monetisation: yes, covered by critical migration item.

### Main bundle is very large

- Problem: production build reports `assets/index-*.js` at 1,448.69 kB minified (345.37 kB gzip) and warns above 500 kB.
- Affected files: `frontend/src/App.jsx`, page imports, large dependencies such as OCR.
- Why it matters: slow initial load on lower-end devices/networks.
- Recommended solution: lazy-load route pages and OCR/emulator-specific code; measure before/after.
- Change risk: medium.
- Before monetisation: no, unless performance testing shows conversion-impacting delays.

### External artwork calls are browser-side and brittle

- Problem: library code calls GitHub and Libretro endpoints directly and parses remote directory behavior.
- Affected files: `frontend/src/pages/LocalLibraryPage.jsx`, `backend/app/api/routes/library_media.py`.
- Why it matters: rate limits/CORS/upstream layout changes affect UX and can leak client IP/query behavior.
- Recommended solution: document fallback/cache behavior, identify requests with appropriate policy, and add resilient server-side metadata/cache jobs if permitted.
- Change risk: medium.
- Before monetisation: no.

### Incomplete feature/status metadata

- Problem: present-but-not-clearly-exposed runtimes (`dreamcast`, `emulator-pinball`) and super-admin/preview systems are not centrally declared with readiness/support levels.
- Affected files: `frontend/public/`, `LobbyPage.jsx`, `LocalLibraryPage.jsx`, `RoomPage.jsx`.
- Why it matters: users and developers can mistake experimental assets for supported product features.
- Recommended solution: define a single documented support matrix and keep UI gating explicit.
- Change risk: low/medium.
- Before monetisation: recommended.

## Low

### Naming retains original Amstrad-only history

- Problem: package/container/volume names still say `amstrad` although the product supports many systems.
- Affected files: `frontend/package.json`, Compose container/volume names, deployment paths.
- Why it matters: minor cognitive overhead; renaming infrastructure could itself be disruptive.
- Recommended solution: retain names until a planned deployment migration; document aliases.
- Change risk: medium.
- Before monetisation: no.

### Formatting and line endings are inconsistent

- Problem: mixed CRLF/LF warnings and inconsistent formatting are visible across generated and source files.
- Affected files: repository-wide.
- Why it matters: noisy diffs.
- Recommended solution: introduce `.editorconfig`/`.gitattributes` in a dedicated, non-mass-reformat change.
- Change risk: low if no bulk normalization.
- Before monetisation: no.
