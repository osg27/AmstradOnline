# Admin gameplay dashboard

Deploy backend and frontend together. Startup creates the new `play_sessions`
table through existing `Base.metadata.create_all`; no manual ALTER is required.
No historical play data can be reconstructed from the former live-only presence
rows. Collection begins with the first room heartbeat after deployment.

The admin dashboard includes period, user/game/room, system, mode and connection
filters, host game-time graphs, distinct room/player counts, and paginated room
timelines. All history is protected by the existing backend `require_admin`.
Room drill-down includes the entire retained history of that room, irrespective
of overview filters. Graph dates are UTC; table timestamps use the viewer's zone.

Each record represents one participant's attendance with a particular game,
system and hosting mode. Server state supplies the room, host, mode and identity;
only the host's existing game-name heartbeat supplies the game label. A loaded
filename is not proof that the emulator booted successfully or that input occurred.
Guests do not get to change the recorded game or host. Names are text, never HTML.

Heartbeats run every 15 seconds, with additional updates on game/peer changes.
Gaps over 60 seconds end a record at its last observed heartbeat; reconnecting
starts a new record. Leaving also ends at the last observation. No time is added
after the final heartbeat, including after a server restart or closed browser.
System/game/mode changes and UTC day boundaries split records. Period filters
select records by start time. Consequently time is conservative and
can miss up to a heartbeat interval around transitions. Duration is attendance
with loaded media, not active playing time. Waiting is retained but excluded from
game-time graphs. Game-time totals count hosts only, never host plus guest time.

Peer status comes from the browser's existing RTCPeerConnection state. It is
explicitly marked browser-reported; it is not server-verified stream delivery,
data-channel input or a trusted anti-abuse metric. Solo reports cannot be marked
connected. Connected duration accumulates only between consecutive connected
observations. Very brief connections may have a zero duration. Spectators are
recorded as guests: this release does not infer controller ownership.

Records persist independently of room deletion and backend restarts. Admin
account deletion removes rows for that participant and rooms they hosted. No IP,
tokens, source URLs, chat, voice or gameplay footage are stored. History currently
has no automatic retention deletion; set a retention policy before extensive
public rollout, include this activity collection in the privacy notice and monitor
table size in backups. Queries are paginated; graphs show the latest 31 active
days within the selected period. Refresh is manual to avoid a costly polling loop.
Existing single-worker WebSocket requirements remain unchanged.

Tests: `backend/tests/test_play_history.py` verifies game transitions, timeout and
rejoin accounting, guest separation, solo rules, room deletion persistence,
admin authorization and aggregates that do not double-count players.
