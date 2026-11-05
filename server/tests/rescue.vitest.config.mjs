import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: fileURLToPath(new URL('../node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('../node_modules/react-dom', import.meta.url)),
      recharts: fileURLToPath(new URL('../node_modules/recharts', import.meta.url)),
    },
  },
  test: { include: ['server/tests/{rescue,orders}*.test.{mjs,jsx}'], environment: 'node' },
});
