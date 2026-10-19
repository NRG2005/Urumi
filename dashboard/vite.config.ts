import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev, proxy API and MCP calls to a locally running gateway (in the cluster, the Ingress does this).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8800',
      '/mcp': 'http://localhost:8800',
    },
  },
})
