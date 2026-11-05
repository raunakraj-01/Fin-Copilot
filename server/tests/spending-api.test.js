import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import CashItem from '../src/models/CashItem.js';

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); }, 600000);
afterEach(() => vi.useRealTimers());
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
async function setup() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-05T08:00:00Z'));
  const workspace = (await request(app).post('/api/workspaces').send({ name: 'Spending pilot', asOfDate: '2026-11-05', openingCashPaise: 100000, minimumReservePaise: 20000 }).expect(201)).body.workspace;
  const base = `/api/workspaces/${workspace.id}`;
  const invoice = (await request(app).post(`${base}/items`).send({ externalId: 'INV-SPEND', category: 'receivable', counterparty: 'Buyer', amountPaise: 80000,
    dueDate: '2026-11-07', expectedDate: '2026-11-07' }).expect(201)).body.item;
  await request(app).post(`${base}/items`).send({ externalId: 'PAYROLL', category: 'payable', counterparty: 'Payroll', amountPaise: 60000,
    dueDate: '2026-11-09', expectedDate: '2026-11-09' }).expect(201);
  return { base, invoice, id: workspace.id };
}

it('exposes conditional expected/delayed limits and tests proposed spending without writing cash records', async () => {
  const { base, id } = await setup();
  const before = await CashItem.find({ workspaceId: id }).lean();
  const unconfirmed = (await request(app).get(`${base}/spending-check`).expect(200)).body;
  expect(unconfirmed.status).toBe('incomplete');
  expect(unconfirmed.expected.spendablePaise).toBeNull();
  const result = (await request(app).get(`${base}/spending-check?commitmentsConfirmed=true&spendPaise=20001`).expect(200)).body;
  expect(result.expected.spendablePaise).toBe(80000);
  expect(result.delayed.spendablePaise).toBe(20000);
  expect(result.expected.canSpend).toBe(true);
  expect(result.delayed.canSpend).toBe(false);
  expect(result.delayDays).toBe(7);
  expect(result.horizonDays).toBe(30);
  expect(await CashItem.find({ workspaceId: id }).lean()).toEqual(before);
});

it('uses payment promises and updates on revision and missing commitment data', async () => {
  const { base, invoice } = await setup();
  const created = (await request(app).post(`${base}/items/${invoice.id}/promises`).send({ amountPaise: 80000, promisedDate: '2026-11-11' }).expect(201)).body;
  const url = `${base}/spending-check?commitmentsConfirmed=true`;
  expect((await request(app).get(url)).body.expected.spendablePaise).toBe(20000);
  await request(app).patch(`${base}/items/${invoice.id}/promises/${created.promises[0].id}`).send({ amountPaise: 80000, promisedDate: '2026-11-07' }).expect(200);
  expect((await request(app).get(url)).body.expected.spendablePaise).toBe(80000);
  await request(app).post(`${base}/items`).send({ category: 'expense', counterparty: 'Unconfirmed tax payment', amountPaise: 7000,
    dueDate: '2026-11-12', confidenceState: 'needs_review' }).expect(201);
  const incomplete = (await request(app).get(url)).body;
  expect(incomplete.status).toBe('incomplete');
  expect(incomplete.dataQuality.excludedPaymentsPaise).toBe(7000);
  expect(incomplete.recommendedSpendablePaise).toBeNull();
});

it('rejects invalid query parameters and scopes data to the requested workspace', async () => {
  const { base } = await setup();
  for (const query of ['horizonDays=0', 'horizonDays=366', 'delayDays=-1', 'delayDays=5', 'spendPaise=1.1', 'spendPaise=-1', 'spendPaise=9007199254740992', 'commitmentsConfirmed=1', 'today=2026-11-05'])
    await request(app).get(`${base}/spending-check?${query}`).expect(400);
  await request(app).get('/api/workspaces/bad/spending-check').expect(404);
  await request(app).get('/api/workspaces/000000000000000000000001/spending-check').expect(404);
  const other = (await request(app).post('/api/workspaces').send({ name: 'Other business', asOfDate: '2026-11-05', openingCashPaise: 50000 }).expect(201)).body.workspace;
  const result = (await request(app).get(`/api/workspaces/${other.id}/spending-check?commitmentsConfirmed=true`)).body;
  expect(result.expected.includedPaymentsPaise).toBe(0);
  expect(result.expected.spendablePaise).toBe(50000);
});

it('uses the Indian business date and blocks yesterday’s snapshot after midnight IST', async () => {
  const { base } = await setup();
  vi.setSystemTime(new Date('2026-11-05T18:31:00Z')); // 6 November in India
  const result = (await request(app).get(`${base}/spending-check?commitmentsConfirmed=true`).expect(200)).body;
  expect(result.evaluatedOn).toBe('2026-11-06');
  expect(result.dataQuality.snapshotAgeDays).toBe(1);
  expect(result.dataQuality.issues.some(i => i.code === 'STALE_CASH')).toBe(true);
  expect(result.expected.spendablePaise).toBeNull();
});
