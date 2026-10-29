# WebX68k runtime

The PX68k WebAssembly core and browser host are from URARA-works/WebX68k,
licensed under GPL-2.0-only; see COPYING.

- Upstream: https://github.com/uraraworks/WebX68k
- WebX68k revision: 96abd36d33f8f8b78e114b4847d449c5c0684498
- Exact upstream source: https://github.com/uraraworks/WebX68k/archive/96abd36d33f8f8b78e114b4847d449c5c0684498.tar.gz
- Core revision: c7f831fc7ad6892c46f774ce15764644304cb328
- Core source: https://github.com/uraraworks/px68k-libretro/tree/c7f831fc7ad6892c46f774ce15764644304cb328
- Core build instructions: scripts/build-core.sh in the pinned WebX68k source.
- Build metadata: px68k_libretro.build.json alongside this notice.

The browser host source is included in frontend/src/features/x68000/vendor/webx68k.
Old Style Gaming's room adapter is frontend/src/features/x68000/launcher.js.
Run `npm run build:x68000` in frontend to regenerate the browser launcher bundle.
The vendored core binaries are unmodified. No upstream BIOS or system disk is shipped.
