import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The site reuses the app's Keyboard component, layout and styles from ../src, and the
// screenshots and recordings from ../docs/screenshots.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // ../src would otherwise pick up the app's own copies from ../node_modules.
    dedupe: ['react', 'react-dom', 'motion'],
  },
  server: { port: 4323, fs: { allow: ['..'] } },
  preview: { port: 4323 },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
})
