import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['src/features/x68000/launcher.js'],
  outfile: 'public/x68000/launcher.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'eof',
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.BASE_URL': '"/x68000/"',
    __BUILD_ID__: '"webx68k-96abd36"',
  },
  banner: { js: '/* WebX68k host/core: GPL-2.0-only. See /x68000/webx68k/NOTICE.md and COPYING. */' },
});
