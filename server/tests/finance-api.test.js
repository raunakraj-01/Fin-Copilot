import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import app from '../src/app.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';

let mongo;
const execFileAsync = promisify(execFile);
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it('persists both fixture imports and returns the documented shortage', async () => {
  const created = await request(app).post('/api/workspaces').send({ name: 'Demo Packaging Supplier',
    asOfDate: '2026-11-01', openingCashPaise: 20_000_000, minimumReservePaise: 0 }).expect(201);
  const id = created.body.workspace.id;
  for (const [name, kind] of [['receivables.csv', 'receivables'], ['payables.csv', 'payables']]) {
    const file = await readFile(new URL(`../../fixtures/${name}`, import.meta.url));
    const inspected = await request(app).post(`/api/workspaces/${id}/imports/inspect`)
      .field('kind', kind).attach('file', file, name).expect(201);
    const batchId = inspected.body.batchId;
    const validated = await request(app).post(`/api/workspaces/${id}/imports/${batchId}/validate`)
      .send({ mapping: inspected.body.suggestedMapping }).expect(200);
    expect(validated.body.counts.accepted).toBe(kind === 'receivables' ? 2 : 3);
    const committed = await request(app).post(`/api/workspaces/${id}/imports/${batchId}/commit`).send({}).expect(200);
    expect(committed.body.savedCount).toBe(kind === 'receivables' ? 2 : 3);
    await request(app).post(`/api/workspaces/${id}/imports/${batchId}/commit`).send({}).expect(200);
  }
  const items = await request(app).get(`/api/workspaces/${id}/items`).expect(200);
  expect(items.body.items).toHaveLength(5);
  const duplicateFile = await readFile(new URL('../../fixtures/receivables.csv', import.meta.url));
  const repeat = await request(app).post(`/api/workspaces/${id}/imports/inspect`)
    .field('kind', 'receivables').attach('file', duplicateFile, 'receivables.csv').expect(201);
  await request(app).post(`/api/workspaces/${id}/imports/${repeat.body.batchId}/validate`)
    .send({ mapping: repeat.body.suggestedMapping }).expect(200);
  const duplicateCommit = await request(app).post(`/api/workspaces/${id}/imports/${repeat.body.batchId}/commit`).send({}).expect(200);
  expect(duplicateCommit.body.savedCount).toBe(0);
  expect(duplicateCommit.body.duplicateConflicts).toHaveLength(2);
  const forecast = await request(app).get(`/api/workspaces/${id}/forecast`).expect(200);
  expect(forecast.body.daily).toHaveLength(90);
  expect(forecast.body.risk.firstNegativeDate).toBe('2026-11-06');
  expect(forecast.body.risk.worstCashPaise).toBe(-20_000_000);
  expect(forecast.body.risk.worstDate).toBe('2026-11-11');
});

it('seeds fixture records idempotently', async () => {
  const seed = async () => execFileAsync(process.execPath, ['src/seed/index.js'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, MONGODB_URI: mongo.getUri() },
  });
  await seed();
  await seed();
  const workspace = await Workspace.findById('650000000000000000000001');
  expect(workspace.openingCashPaise).toBe(20_000_000);
  expect(await CashItem.countDocuments({ workspaceId: workspace._id })).toBe(5);
}, 30_000);

it('creates and corrects manual items and monthly expenses', async () => {
  const created = await request(app).post('/api/workspaces').send({ name: 'Manual test',
    asOfDate: '2026-11-01', openingCashPaise: 20_000_000, minimumReservePaise: 0 }).expect(201);
  const id = created.body.workspace.id;
  const item = await request(app).post(`/api/workspaces/${id}/items`).send({ category: 'receivable',
    counterparty: 'Example buyer', amountPaise: 10_000_000, settledPaise: 0, status: 'open',
    dueDate: '2026-11-10', confidenceState: 'needs_review' }).expect(201);
  expect(item.body.item.outstandingPaise).toBe(10_000_000);
  const unverified = await request(app).get(`/api/workspaces/${id}/forecast`).expect(200);
  expect(unverified.body.warnings).toHaveLength(1);
  const corrected = await request(app).patch(`/api/workspaces/${id}/items/${item.body.item.id}`)
    .send({ expectedDate: '2026-11-12', confidenceState: 'owner_assumption' }).expect(200);
  expect(corrected.body.item.expectedDate).toBe('2026-11-12');
  await request(app).post(`/api/workspaces/${id}/recurring-rules`).send({ description: 'Rent',
    amountPaise: 2_500_000, dayOfMonth: 5, startsOn: '2026-11-01' }).expect(201);
  const forecast = await request(app).get(`/api/workspaces/${id}/forecast`).expect(200);
  expect(forecast.body.daily.find(day => day.date === '2026-11-05').paymentsPaise).toBe(2_500_000);
  expect(forecast.body.daily.find(day => day.date === '2026-11-12').receiptsPaise).toBe(10_000_000);
});
