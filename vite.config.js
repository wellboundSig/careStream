import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      // Esper API proxy (avoids CORS in development)
      '/esper-proxy': {
        target: 'https://ricct-api.esper.cloud',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/esper-proxy/, ''),
      },
      // Zip code lookup proxy
      '/zip-proxy': {
        target: 'https://api.zippopotam.us',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/zip-proxy/, ''),
      },
      // Nominatim reverse geocoding (OSM, no key needed)
      '/nominatim-proxy': {
        target: 'https://nominatim.openstreetmap.org',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/nominatim-proxy/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => {
            req.setHeader('User-Agent', 'CareStream/1.0 (contact@wellbound.com)');
          });
        },
      },
    },
  },
})
