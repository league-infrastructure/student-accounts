import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.VITE_API_URL || 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_DOMAIN__: JSON.stringify(process.env.APP_DOMAIN || 'myapp.jtlapp.net'),
  },
  server: {
    allowedHosts: ['crispin.local'],
    proxy: {
      '/api': {
        target: apiTarget,
        // Keep the browser's Host header (localhost:5173) so Passport
        // constructs OAuth callback URLs through the Vite proxy,
        // not directly to the backend (localhost:3000).
        changeOrigin: false,
      },
      // LLM proxy forwarder is mounted at /proxy (outside /api) so
      // `ANTHROPIC_BASE_URL=<origin>/proxy` works when the dev server
      // is the student's origin too.
      '/proxy': {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
})
