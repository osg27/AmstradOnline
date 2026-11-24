# Amiga Link Play (null-modem) — status and handover

Validation updated: 2026-11-24. Prepared on `feature/amiga-link-play`; no production deployment.

The owner reports a successful manual test using two Chrome instances. The earlier
Stunt Car Racer stall described below is historical evidence and has not been
independently cleared by that report; full game compatibility is not guaranteed.

## Status in one paragraph

Two browser-based vAmiga instances now exchange serial data both ways through the
`amiga_link` room, over the existing WebRTC DataChannel. This is proven at the Amiga CPU
level with a self-made test disk, both on one page and between two separate Chrome
processes using the real room page, signaling server and WebRTC. Stunt Car Racer's own
"Computer Link" handshake succeeds on both machines ("Link complete"), but the game
then does not continue to a race. That last step is the open blocker.

## Why the old implementation never worked (evidence-based)

1. **Receive path dropped every byte.** `launcher.js` posted `{byte}` to vAmiga.
   vAmigaWeb only accepts serial input as `{cmd:"ser:", byte|bytes|text}`
   (`public/amiga/js/vAmiga_ui.js` ~line 2451; the upstream wiki agrees). Fixed.
2. **vAmiga's null-modem path was 8-bit only.** Stunt Car Racer runs the UART in 9-bit
   (LONG) mode: SERPER = `$8174`, 8 data bits + odd parity in bit 8 + stop bit in bit 9.
   It discards any byte whose parity fails. vAmiga truncated outgoing words with
   `char(byte)` and buffered incoming data as `u8`, so every byte with an even number of
   1 bits was dropped. The packet header `12 56` was never accepted, while the preamble
   bytes `80`/`40` were, which is why "Link complete" appeared. Found by disassembling the
   game's serial routines at disk offset `$E5DC`–`$E7B8`. Fixed with a small vAmiga
   patch (below).
3. **Dev-only: Vite served the React app for `/amiga/?v=`.** Fixed by loading
   `index.html?v=` explicitly. Production static hosting was probably unaffected.
4. The old counters measured bytes at the room page, not inside the Amiga, and the
   per-byte React state updates would have caused heavy re-rendering. Fixed.

## What changed

- `frontend/public/amiga/launcher.js`
  - Serial output is batched per emulated frame: vAmiga's out handler is replaced, and
    each microtask flush posts one message.
  - Input goes in as 10-bit SERDAT words through the new `Module._wasm_write_word_to_ser`.
    Older runtimes fall back to `{cmd:"ser:", bytes}`.
  - Diagnostics: stage counters and full streams via `getAmigaSerialDiagnostics()`
    (`uartTx`, `toRoom`, `fromRoom`, `emuIn`, `inputPath`).
  - `runtimeVersion` bumped. `index.html` explicitly versions both the runtime JS
    and WASM requests; iframe query parameters alone do not version subresources.
- `frontend/src/pages/RoomPage.jsx`
  - DataChannel packets use a `0x02` tag followed by 16-bit little-endian words
    (codec in `src/features/amiga/amigaSerialPacket.js`, plus a test).
  - Counters are kept in refs and copied to state every 500 ms.
  - Symbols sent while the link is down are counted as "lost".
  - Adds `window.__amigaLinkDiagnostics()` and a "Serial log" download button in the
    session strip.
  - Launcher URL version bumped.
- vAmiga core (nested repo `vAmigaWeb/`, patch saved as `patches/vamigaweb-serial-9bit.patch`):
  - The `SerServer` buffer is now `u16`, with a new `processIncomingWord`.
  - `SerialPort::recordOutgoingByte` keeps 10 bits.
  - New export `wasm_write_word_to_ser` (added to both `EXPORTED_FUNCTIONS` lists in `CMakeLists.txt`).
  - Byte/string APIs behave as before.
- `frontend/public/amiga/vAmiga.js` + `vAmiga.wasm` are replaced with the patched build.
  It was built in a scratch directory; `vAmigaWeb/build/` is untouched. The originals are
  in git (`git checkout -- frontend/public/amiga/vAmiga.*` restores them).
- Only `amiga_link` uses `/amiga/launcher.html` and vAmiga. Normal Amiga and AGA rooms
  are PUAE and are not touched.

### Rebuilding vAmiga (as done this session)

```
call <emsdk>\emsdk_env.bat
set PATH=C:\msys64\ucrt64\bin;%PATH%
cd vAmigaWeb
emcmake cmake -S . -B <builddir> -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release -DCMAKE_MAKE_PROGRAM=C:/msys64/ucrt64/bin/mingw32-make.exe
cmake --build <builddir> -j 8
```

The link step needs `shell.html` in the parent of `<builddir>`, so copy `vAmigaWeb/shell.html` there first.

## Test tooling (`frontend/tests/amiga-link/`)

| File | Purpose |
|---|---|
| `serial-pingpong.s` / `build-pingpong-adf.py` | Original boot-block test disk (vasm). It replies to each received byte with byte+1 and shows the received byte as the background colour. A reply is only possible if the Amiga CPU read the byte. |
| `serve.py` | Local static server: `frontend/public` plus `/__linktest/` (with `--kickstart`/`--game` local paths; ROMs/games are never copied into the repo). |
| `two-local.html` + `run-two-local.mjs` | Two real launchers on one page, cross-wired (`?latency=ms` optional). |
| `run-steps.mjs` | Same harness with scripted keyboard/joystick/mouse input and screenshots. |
| `local-backend.py` | Real backend on SQLite with tester users LinkTestA/LinkTestB. SMTP is pointed at a closed port. Needs a venv with `backend/requirements.txt`. |
| `run-two-browsers.mjs` | Two separate headless Chrome profiles join one room via the real RoomPage + WebRTC. |
| `verify-pingpong.mjs`, `verify-link.mjs` | Verdicts from `diagnostics.json`. |
| `evidence/` | Logs and screenshots from this session (below). |

Local runs use Vite on **port 4173**, with
`VITE_API_BASE_URL=http://127.0.0.1:8000` and
`VITE_WS_BASE_URL=ws://127.0.0.1:8000`, plus the test file server on 8765.
Supply your own legally obtained Kickstart/game paths to `serve.py`; never commit them.
Generate `serial-pingpong.adf` using `build-pingpong-adf.py` before running the harness.
Raw evidence, screenshots, generated disks and authentication tokens remain local
and are intentionally excluded from this commit.

## Evidence

- `evidence/pingpong-two-local.json`: about 690 words each way, word-exact. Each Amiga's
  replies equal its received bytes + 1 → **PASS**.
- `evidence/pingpong-webrtc-two-browsers.json`: the same over the real room + WebRTC
  between two Chrome processes. 694 bytes each way, reply = received + 1 → **PASS**.
- `evidence/stuntcar-before-9bit-fix.json`: both sides loop forever on one identical
  9-byte packet (`12 56 34 00 40 00 e3 80 47` / `… e3 00 c7`), whatever the input.
- `evidence/stuntcar-after-9bit-fix.json` and `stuntcar-webrtc-two-browsers.json`:
  word-exact delivery including bit 8, and B now replies with `… aa 00 8e`. Both show
  "Link complete" (`stuntcar-link-complete.png`).

## Open blocker: Stunt Car Racer stalls after "Link complete"

- A (master, preamble `80`) keeps resending `12 56 34 00 40 00 e3 80 47` about every 160 ms.
- B (preamble `40`) alternates its idle packet with an `aa` reply about one frame after
  each A packet. A never changes its packet.
- No keyboard, joystick or mouse input changes either screen.
- Leading hypothesis (unproven): reply latency. vAmigaWeb computes a whole frame at a
  time, so a reply can reach the other Amiga only on its next frame, which is 20–40 ms of
  emulated time. A real cable returns a 9-byte packet in about 10 ms. If A's handshake
  timeout is shorter than a frame, it will never accept B's reply.

Suggested next steps:

1. Reverse-engineer A's handling of the `aa` reply. The receive buffer is at `$EB56`,
   indices `$F254`/`$F255`; the RBF interrupt handler is at `$E4C4` → `jsr $F1E0`.
   Look for a timeout counter.
2. If it is a timeout, try running both emulators in smaller time slices (needs a
   vAmiga export to run part of a frame) or a lockstep scheme. That is a larger
   emulator change, so decide deliberately.
3. Find another null-modem title as ADF/DMS. vAmiga can't load IPF, and the romset
   copies (Lotus, F-29, Populous, Knights of the Sky, Falcon) are IPF. The ping-pong
   test already proves the plain 8-bit path, so a lenient 8-bit game might work as-is.
4. Not yet handled: RS-232 handshake lines. Stunt Car Racer's manual cable crosses
   RTS/CTS and DTR→DSR+CD, and the game code reads CIA-B PRA. vAmiga's null-modem mode
   doesn't propagate these lines.

## Other notes

- Frontend suite on 2026-11-24: all 31 files / 242 tests pass. The initial
  sandboxed invocation failed with Node EPERM; running outside the sandbox passed.
  The earlier Vitest config failure was not reproduced. Production build passes
  with existing chunk-size and mixed-import warnings.
- `SER_DEVICE` is never set to NULLMODEM and doesn't need to be: input via
  `wasm_write_*_to_ser` starts the receive scheduler itself.

## Production checklist

Deploy the frontend build as one unit, including `public/amiga/index.html`,
`launcher.html`, `launcher.js`, `vAmiga.js` and `vAmiga.wasm`. No new backend
migration or configuration is required: existing room signaling and WebRTC/TURN
configuration are reused. Verify two clients over the deployed network (including
TURN where needed). Both clients should reload onto the same new frontend.
Normal `amiga` and `amiga_aga` rooms still select the unchanged PUAE launcher.

The runtime JS and WASM now use explicit versioned URLs. Any CDN configured to
ignore query strings must be purged or configured to respect them before rollout.
No production deployment has been performed. RS-232 handshake lines are not
propagated; frame-sized batching and game-specific timing remain limitations.

To rebuild the core, apply the saved patch and add `_wasm_write_word_to_ser`
after `_wasm_write_byte_to_ser` in both CMake export lists as instructed in the
patch header. The ignored local upstream tree is not a production dependency.

## Binary verification (2026-11-24)

The shipped JS maps `_wasm_write_word_to_ser` to WASM export `Sa`. Disassembly
confirms that export calls a receive routine using `i32.store16` and a `1023`
mask, preserving all 10 SERDAT bits. Both assets are copied byte-for-byte into
the production build. SHA-256:

- JS: `15fa1a04a52ef6407a0e128ae656e9d19d49830f581e590ebb7463df11084db3`
- WASM: `f9e5b67f58cc2ee410761903755dd71aa9ab56df99e2758c7bbbb02ca9846cfd`

Both saved ping-pong captures and both post-fix 9-bit captures pass their
verifiers. A fresh two-local Chrome run without a supplied Kickstart loaded
both emulator hooks but produced no UART traffic in 20 seconds; it is not a
passing end-to-end test. The owner's two-Chrome manual result and prior captures
remain the functional evidence. No private ROM was used or added during validation.

Final backend validation: 133 tests and 70 subtests pass (35 dependency deprecation
warnings) using an isolated in-memory SQLite database. Initial attempts failed
because the Windows venv executable was absent and the local dependency folder
lacked `python-multipart`; after adding that dependency locally, all tests pass.
These were environment failures, with no backend source changes required.
`git diff --check` reports whitespace on context lines inside the saved upstream
patch; the patch is retained as supplied and its header uses `--ignore-whitespace`.
