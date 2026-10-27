import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { recharts: fileURLToPath(new URL('./node_modules/recharts', import.meta.url)) },
  },
});
