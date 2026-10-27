// Run from any directory: node server/tests/rescue-verify.mjs [--preview]
// Installs verification tools into a temporary directory, never shared package files.
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const sandbox = await mkdtemp(join(tmpdir(), 'cashflow-person2-'));
const packages = ['recharts@3.10.1', 'zod@4.6.7', 'express@5.3.0', 'react@19.3.1', 'react-dom@19.3.1', 'vitest@4.1.12', 'supertest@7.3.1', 'jsdom@29.1.1', '@testing-library/react@16.3.3', 'esbuild@0.28.2'];
function run(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd: sandbox, stdio: 'inherit' });
    process.on('error', reject);
    process.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
console.log(`Verification workspace: ${sandbox}`);
for (const path of ['server/src/services/rescue', 'server/src/services/orders', 'server/src/services/finance/forecast.js', 'server/src/controllers/rescueDecisionHandler.js', 'server/src/routes/rescue.js', 'server/src/routes/orders.js', 'server/tests', 'client/src/pages/RescuePlanner', 'client/src/pages/RescuePlanner.jsx', 'client/src/pages/OrderAnalyzer', 'client/src/pages/OrderAnalyzer.jsx', 'fixtures']) {
  await cp(join(repository, path), join(sandbox, path), { recursive: true });
}
await writeFile(join(sandbox, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
await run('npm', ['install', '--no-audit', '--no-fund', ...packages]);
await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'server/tests/rescue.vitest.config.mjs']);
const { build } = await import(pathToFileURL(join(sandbox, 'node_modules/esbuild/lib/main.js')));
await build({ entryPoints: [join(sandbox, 'server/tests/rescue-preview-entry.jsx')], bundle: true, outfile: join(sandbox, 'preview/app.js'), format: 'esm', jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
await mkdir(join(sandbox, 'preview'), { recursive: true });
await writeFile(join(sandbox, 'preview/index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CashFlow Copilot · Person 2 preview</title><link rel="stylesheet" href="/app.css"></head><body style="margin:0;background:#f6f8f5"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
console.log('Person 2 tests and production-mode React bundle passed.');
if (process.argv.includes('--preview')) await run(process.execPath, ['server/tests/rescue-preview.mjs']);
else console.log(`Preview with: node ${join(sandbox, 'server/tests/rescue-preview.mjs')}`);
