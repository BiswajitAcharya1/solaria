import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.API_URL || 'http://127.0.0.1:8000' } },
  build: { chunkSizeWarningLimit: 5000 },
})
