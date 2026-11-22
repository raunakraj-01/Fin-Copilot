import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

if (typeof globalThis.localStorage !== 'undefined' && typeof globalThis.localStorage.getItem !== 'function') {
  delete globalThis.localStorage;
}

export default defineConfig({
  test: {
    maxWorkers: 2,
    setupFiles: [fileURLToPath(new URL('./tests/setupVitest.js', import.meta.url))],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { recharts: fileURLToPath(new URL('./node_modules/recharts', import.meta.url)) },
  },
});
