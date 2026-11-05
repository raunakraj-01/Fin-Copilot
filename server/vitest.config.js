import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: { maxWorkers: 2 },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { recharts: fileURLToPath(new URL('./node_modules/recharts', import.meta.url)) },
  },
});
