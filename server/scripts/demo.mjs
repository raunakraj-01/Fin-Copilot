import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';

const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
let database;
let server;
async function stop() {
  server?.close();
  await mongoose.disconnect();
  await database?.stop();
}
try {
  await access(`${clientDist}/index.html`);
  database = await MongoMemoryServer.create();
  const uri = database.getUri();
  execFileSync(process.execPath, [fileURLToPath(new URL('../src/seed/index.js', import.meta.url))], {
    env: { ...process.env, MONGODB_URI: uri }, stdio: 'pipe', timeout: 30_000,
  });
  await mongoose.connect(uri);
  const demo = express();
  demo.use(express.static(clientDist));
  demo.use(app);
  server = demo.listen(5000, 'localhost');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  console.log('Synthetic demo ready: http://localhost:5000 — choose Use seeded demo workspace.');
  console.log('Uses an isolated temporary database. Demo edits disappear when this process stops.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().then(() => process.exit(0)); });
} catch {
  console.error('Demo could not start. Build the client first, free port 5000, and check that the MongoDB test runtime can start.');
  await stop();
  process.exitCode = 1;
}
