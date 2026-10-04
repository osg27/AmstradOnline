# Public game sources (preview)

Library → system cog → Link source URL accepts a public HTTPS page, an
Internet Archive **item** URL, or a direct game-file URL. The system is selected
by the cog. Scanning links all matching files to that system's normal game shelf.
The same dialog supports adding, rescanning and unlinking PC folders and URLs.
Existing connected-source catalogues appear automatically; links persist until
unlinked (or browser storage is cleared). Play downloads only the selected file and
passes its original filename and bytes to the existing room File launcher.
No personal cloud account connection or OAuth is implemented.

Catalogues are stored per username in this browser's IndexedDB; they are
not synchronised between devices. Clearing browser storage removes them.
Game bytes are not persisted in the catalogue. A room reload requires loading
the file again, just like the existing temporary file handoff.

## Scope

- Internet Archive metadata discovery; collections are not recursively scanned.
- Other sites: links in one HTML page, including relative links. No JavaScript
  scraping, login, access-control bypass, recursive crawl or pagination.
- 20 saved sources; safety bounds of 100,000 matching files, 300,000 HTML links
  and a 64 MiB listing per scan. Truncation is explicitly reported.
- Linked games use the standard shelf search, alphabet, favourites, version
  grouping, artwork lookup and incremental rendering. There is no separate URL
  catalogue/grid. Source games are kept separate from folder records in storage,
  so folder rescans and unlinks cannot accidentally delete URL links.
- Existing localStorage catalogues migrate after a successful IndexedDB write.
- 128 MiB per game and per ZIP's expanded contents, at most 2,048 ZIP entries.
- Supported systems/extensions are listed in `game_sources.py`. CD track sets,
  playlists, 7z archives and multi-disk grouping are outside this preview.
- Filenames identify candidates, not verified games. A ZIP should contain one
  game's media, not an entire collection. Existing firmware requirements apply.

## Deployment and security

Deploy both backend and frontend; no database migration or new dependencies.
The frontend uses authenticated POST endpoints `/auth/library/sources/scan`
and `/auth/library/sources/download`, under the existing production API proxy
prefix. The original `/library/sources/*` backend aliases remain available,
but nginx may route those paths to the React shell (POST then returns HTML 405).
Both aliases enforce
existing server-side system access, including admin/early-access restrictions.
HTTPS port 443 only; credentials and private/local/reserved addresses are rejected.
DNS results are checked and sockets pinned to a validated IP, retaining TLS host
verification. Redirects repeat these checks. No application tokens, cookies or
upstream credentials are forwarded. Page HTML is never rendered or executed.

Downloads use temporary spooled files (2 MiB in memory, then temporary disk),
closed after response delivery. Allow temporary disk space for four concurrent
128 MiB downloads. Upstream fetching uses socket timeouts and bounded reads.
ZIP validation rejects unsafe paths, encryption, excessive expansion and entries.

Rate guards: one active operation per user, four globally, 12 scans/minute and
20 downloads/minute per user. These are technical limits, unrelated to plans.
They are process-local: retain the application's existing single-worker deployment.
Monitor server egress and temporary storage before increasing preview limits;
downloads pass through this server and upstream hosts can throttle/block them.
Cancellation stops the browser request; a synchronous upstream fetch can continue
until completion or its configured bounds. Deploy proxy-level request/bandwidth
controls for additional protection at higher traffic volumes.

Tests: `backend/tests/test_game_sources.py` uses mocked public responses to test
discovery, byte/filename preservation, size limits, ZIP traversal, network URL
checks, access enforcement and concurrent-request protection. It does not certify
availability or game compatibility for every third-party website.
