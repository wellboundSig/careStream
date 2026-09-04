import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: [],
    css: false,
    // services/wellbound-api tests use node:test and run under plain Node,
    // not vitest.
    exclude: ['**/node_modules/**', 'services/**'],
  },
});
