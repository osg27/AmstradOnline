import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const legacyCssBundles = [
  'index-BWgDdnHi.css',
  'index-BajL6AJ3.css',
  'index-BcT-yQC7.css',
  'index-BqaB7wKr.css',
  'index-BX8l7IkM.css',
  'index-DainidUW.css',
  'index-DZr0TSd2.css',
  'index-H7fp8ncV.css',
  'index-OAZ7NqNQ.css',
];

function retainLegacyCssUrls() {
  return {
    name: 'retain-legacy-css-urls',
    closeBundle() {
      const assetsDirectory = join(process.cwd(), 'dist', 'assets');
      const currentBundles = readdirSync(assetsDirectory)
        .filter((name) => /^index-.*\.css$/.test(name) && !legacyCssBundles.includes(name))
        .map((name) => ({ name, modified: statSync(join(assetsDirectory, name)).mtimeMs }))
        .sort((left, right) => right.modified - left.modified);
      if (!currentBundles.length) return;
      const currentCss = join(assetsDirectory, currentBundles[0].name);
      legacyCssBundles.forEach((legacyName) => {
        copyFileSync(currentCss, join(assetsDirectory, legacyName));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), retainLegacyCssUrls()],
  build: {
    // Keep previous fingerprinted bundles so a tab restored with an older cached
    // index.html can still load its matching CSS/JS while it revalidates.
    emptyOutDir: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
