import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['src/features/retroachievements/runtime.js'],
  outfile: 'public/retroachievements/runtime.js',
  bundle: true, format: 'iife', target: 'es2022',
});
