import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  test: { include: ['server/tests/{rescue,orders}*.test.{mjs,jsx}'], environment: 'node' },
});
