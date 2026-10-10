// Standalone dev/build config for the Constellation Unfolder (src/constellations/**).
// Kept separate from vite.config.ts so it can run beside the workbench app.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, existsSync } from 'node:fs'

// keep src/constellations/generated/constellations.json in sync with the backend's cache
const SRC = resolve(__dirname, '../data/cache/constellations.json')
if (existsSync(SRC)) copyFileSync(SRC, resolve(__dirname, 'src/constellations/generated/constellations.json'))

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    outDir: 'dist-constellations',
    rollupOptions: { input: resolve(__dirname, 'constellations.html') },
  },
})
