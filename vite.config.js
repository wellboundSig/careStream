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
      // CMS NPPES NPI Registry proxy (no key, blocks browser CORS)
      '/cms-proxy/npi': {
        target: 'https://npiregistry.cms.hhs.gov/api',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/cms-proxy\/npi/, ''),
      },
      // CMS data.cms.gov dataset API proxy (Order & Referring / PECOS data)
      '/cms-proxy/data': {
        target: 'https://data.cms.gov/data-api/v1',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/cms-proxy\/data/, ''),
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
