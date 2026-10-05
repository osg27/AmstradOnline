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

Resolved artwork URLs (including checked misses) are saved separately in
IndexedDB. Room navigation reuses the prepared catalogue and artwork map from
memory; a page reload reads them from IndexedDB. Linking new files checks only
unknown artwork entries. Download box art explicitly retries missing images.
Artwork scan results update the shelf in batches, rather than regrouping the
whole catalogue for every image. The next 48 covers are prefetched with four
concurrent requests. Versioned server image responses permit long-lived browser
caching; unversioned/stale-version requests must revalidate. The shared server
artwork cache returns existing files before contacting upstream providers.

Shelf rendering uses `size=shelf` on existing versioned image URLs. The backend
creates a reusable WebP thumbnail bounded to 320×480, preserving aspect ratio,
under the media volume's `_shelf` directory. Originals remain unchanged. A changed
original gets a new thumbnail key. Install backend requirements (Pillow 12.3.0)
and restart the backend when deploying this change; no database migration or
artwork rescan is necessary. First thumbnail requests create the derivatives.

Saved local games render before background lookup of missing artwork. Linked
catalogues and saved artwork mappings publish together, avoiding an intermediate
catalogue render without its stored artwork. Returning to an existing library
does not display a fetching-library stage.

## Scope

- Internet Archive metadata discovery; collections are not recursively scanned.
- Archive-viewer pages can link individual ZIP members. Encoded member folders
  are preserved in the upstream URL and removed only from the launch filename.
  Play requests that extracted member, not the containing ZIP. This requires
  the upstream site to expose member download links; arbitrary ZIP URLs remain
  ordinary single-file sources. Verified the supplied NES listing: 3,537 files,
  with one 262,160-byte member returning a valid NES header.
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
