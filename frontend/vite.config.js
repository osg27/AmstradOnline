import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
