import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { randomBytes } from 'node:crypto';
import Workspace from '../src/models/Workspace.js';
import SyncBatch from '../src/models/SyncBatch.js';
import PaymentObservation from '../src/models/PaymentObservation.js';
import { pseudonym } from '../src/services/finance/reliability.js';
import { ensureLocalOllama } from '../src/services/ai/startOllama.js';
import { startFollowupWorker } from '../src/services/finance/followups.js';

const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const port = Number(process.env.PORT || 5000);
let database;
let server;
let stopFollowups;
async function stop() {
  stopFollowups?.();
  server?.close();
  await mongoose.disconnect();
  await database?.stop();
}
try {
  process.env.CLIENT_ORIGIN = 'http://localhost:5000';
  await ensureLocalOllama();
  await access(`${clientDist}/index.html`);
  database = await MongoMemoryServer.create();
  const uri = database.getUri();
  execFileSync(process.execPath, [fileURLToPath(new URL('../src/seed/index.js', import.meta.url))], {
    env: { ...process.env, MONGODB_URI: uri }, stdio: 'pipe', timeout: 30_000,
  });
  await mongoose.connect(uri);
  process.env.TELEMETRY_HMAC_KEY = randomBytes(32).toString('hex');
  app.locals.demoMode = true;
  stopFollowups = startFollowupWorker();
  const demoWorkspaceId = '650000000000000000000001';
  await SyncBatch.create({ workspaceId: demoWorkspaceId, companyId: 'Synthetic Tally company', batchId: '00000000-0000-4000-8000-000000000001', count: 5 });
  const buyerHash = pseudonym('22AAAAA0000A1Z5');
  for (let index = 0; index < 5; index++) {
    const supplier = await Workspace.create({ name: `Synthetic supplier ${index + 1}`, asOfDate: '2026-11-01', openingCashPaise: 0 });
    await PaymentObservation.create({ workspaceId: supplier._id, buyerHash,
      supplierHash: pseudonym(String(supplier._id)), sourceId: `demo-payment-${index}`,
      invoiceDate: '2026-08-01', dueDate: '2026-09-15', clearedDate: `2026-10-${String(index + 5).padStart(2, '0')}`,
      amountPaise: 1000000, source: 'tally_verified' });
  }
  const demo = express();
  demo.use((_req, res, next) => { res.set('Referrer-Policy', 'no-referrer'); res.set('X-Frame-Options', 'DENY'); next(); });
  demo.use(express.static(clientDist));
  demo.use((req, res, next) => {
    if (req.path.startsWith('/api')) return app(req, res, next);
    next();
  });
  demo.get('*', (_req, res) => res.sendFile(`${clientDist}/index.html`));
  demo.use(app);
  server = demo.listen(port, 'localhost');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  console.log(`Synthetic demo ready: http://localhost:${port} — create an account, then choose Use seeded demo workspace to create your own sample business.`);
  console.log('Uses an isolated temporary database. Demo edits disappear when this process stops.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().then(() => process.exit(0)); });
} catch {
  console.error(`Demo could not start. Build the client first, free port ${port}, and check that the MongoDB test runtime can start.`);
  await stop();
  process.exitCode = 1;
}
