import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { devApi } from './dev/api.ts'

export default defineConfig({
  plugins: [react(), devApi()],
  server: { port: 4322, strictPort: true },
  preview: { port: 4322 },
})
