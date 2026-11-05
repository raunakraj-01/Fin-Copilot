import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import express from 'express';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import CashItem from '../src/models/CashItem.js';
import OrderScenario from '../src/models/OrderScenario.js';
import { createOrdersRouter } from '../src/routes/orders.js';
import { prepareSavedScenario } from '../src/services/orders/saveScenario.js';
import { buildForecast } from '../src/services/finance/forecast.js';

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); }, 600000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
const terms = { label: 'Materials order', orderValuePaise: 40000, advancePaise: 0, advanceDate: '2026-11-02', finalCollectionDate: '2026-11-20',
  delayedCollectionDays: 14, costLines: [{ description: 'Materials', amountPaise: 30000, paymentDate: '2026-11-03' }] };
async function setup() {
  const workspace = (await request(app).post('/api/workspaces').send({ name: 'Order pilot', asOfDate: '2026-11-01', openingCashPaise: 10000, minimumReservePaise: 5000 }).expect(201)).body.workspace;
  const base = `/api/workspaces/${workspace.id}`;
  const invoice = (await request(app).post(`${base}/items`).send({ category: 'receivable', counterparty: 'Buyer', amountPaise: 20000, dueDate: '2026-11-05', expectedDate: '2026-11-05' }).expect(201)).body.item;
  const saved = (await request(app).post(`${base}/orders/scenarios`).send(terms).expect(201)).body;
  return { base, workspace, invoice, saved, path: `${base}/orders/scenarios/${saved._id}/recalculate` };
}

it('flags a changed ledger and recalculates the threshold in place while preserving prior results and order terms', async () => {
  const { base, workspace, invoice, saved, path } = await setup();
  expect(saved.simulatedMinimumAdvancePaise).toBe(25000);
  expect((await request(app).get(`${base}/orders/scenarios`)).body.scenarios[0].freshness.stale).toBe(false);
  await request(app).patch(`${base}/items/${invoice.id}`).send({ amountPaise: 25000 }).expect(200);
  expect((await request(app).get(`${base}/orders/scenarios`)).body.scenarios[0].freshness.stale).toBe(true);
  await request(app).patch(base).send({ minimumReservePaise: 10000 }).expect(200);
  const cashBefore = await CashItem.find({ workspaceId: workspace.id }).lean();
  const recalculated = (await request(app).post(path).send({}).expect(200)).body;
  expect(recalculated.simulatedMinimumAdvancePaise).toBe(30000);
  expect(recalculated.freshness.stale).toBe(false);
  expect(recalculated.delayedCollectionDays).toBe(14);
  expect(recalculated.analysisHistory[0].minimumAdvancePaise).toBe(25000);
  expect(recalculated.costLines).toEqual(saved.costLines);
  expect(recalculated.advanceDate).toBe(saved.advanceDate);
  expect(await CashItem.find({ workspaceId: workspace.id }).lean()).toEqual(cashBefore);
  expect((await request(app).get(`${base}/orders/scenarios`)).body.scenarios[0].freshness.stale).toBe(false);
});

it('detects promise changes and confirmed partial receipts even within the same timestamp/day', async () => {
  const { base, invoice, saved, path } = await setup();
  const p = (await request(app).post(`${base}/items/${invoice.id}/promises`).send({ amountPaise: 20000, promisedDate: '2026-11-02' }).expect(201)).body.promises[0];
  expect((await request(app).get(`${base}/orders/scenarios`)).body.scenarios[0].freshness.stale).toBe(true);
  const recalculated = (await request(app).post(path).send({}).expect(200)).body;
  expect(recalculated.simulatedMinimumAdvancePaise).toBe(5000);
  const revised = (await request(app).patch(`${base}/items/${invoice.id}/promises/${p.id}`).send({ amountPaise: 20000, promisedDate: '2026-11-04' }).expect(200)).body;
  expect((await request(app).get(`${base}/orders/scenarios`)).body.scenarios[0].freshness.stale).toBe(true);
  await request(app).post(path).send({}).expect(200);
  const { randomUUID } = await import('node:crypto');
  await request(app).post(`${base}/items/${invoice.id}/promises/${revised.promises.at(-1).id}/receipts`).send({ amountPaise: 1000, receivedDate: '2026-11-02', requestId: randomUUID() }).expect(200);
  expect((await request(app).get(`${base}/orders/scenarios`)).body.scenarios[0].freshness.stale).toBe(true);
  expect((await OrderScenario.findById(saved._id)).analysisHistory).toHaveLength(2);
});

it('upgrades legacy scenarios and refuses expired dates or caller-provided amounts', async () => {
  const { base, saved, path } = await setup();
  await OrderScenario.updateOne({ _id: saved._id }, { $unset: { analysisContext: 1, analyzedAt: 1 } });
  expect((await request(app).get(`${base}/orders/scenarios`)).body.scenarios[0].freshness.reason).toBe('legacy_analysis');
  await request(app).post(path).send({}).expect(200);
  await request(app).post(path).send({ simulatedMinimumAdvancePaise: 0 }).expect(400);
  await request(app).patch(base).send({ asOfDate: '2026-11-03' }).expect(200);
  const before = await OrderScenario.findById(saved._id).lean();
  await request(app).post(path).send({}).expect(400);
  expect(await OrderScenario.findById(saved._id).lean()).toEqual(before);
  expect((await request(app).get(`${base}/orders/scenarios`)).body.scenarios[0].freshness.datesExpired).toBe(true);
});

it('scopes recalculation and freshness to the selected workspace', async () => {
  const first = await setup(); const other = await setup();
  await request(app).post(`${other.base}/orders/scenarios/${first.saved._id}/recalculate`).send({}).expect(404);
  await request(app).post(`${other.base}/orders/scenarios/bad/recalculate`).send({}).expect(400);
  expect((await request(app).get(`${other.base}/orders/scenarios`)).body.scenarios).toHaveLength(1);
});

it('returns a conflict when inputs change during calculation or another recalculation wins the write', async () => {
  const context = { asOfDate: '2026-11-01', openingCashPaise: 10000, minimumReservePaise: 5000, cashItems: [], recurringRules: [] };
  const scenario = { _id: '0123456789abcdef01234568', ...prepareSavedScenario(context, terms, buildForecast) };
  const persist = vi.fn(async () => scenario);
  const changedContext = vi.fn().mockResolvedValueOnce(context).mockResolvedValue({ ...context, minimumReservePaise: 6000 });
  const testApp = express(); testApp.use(express.json());
  testApp.use('/api/workspaces/:workspaceId/orders', createOrdersRouter({ loadContext: changedContext, loadScenario: async () => scenario, recalculateScenario: persist, buildForecast, logError: vi.fn() }));
  await request(testApp).post('/api/workspaces/0123456789abcdef01234567/orders/scenarios/0123456789abcdef01234568/recalculate').send({}).expect(409);
  expect(persist).not.toHaveBeenCalled();
  const conflictApp = express(); conflictApp.use(express.json());
  conflictApp.use('/api/workspaces/:workspaceId/orders', createOrdersRouter({ loadContext: async () => context, loadScenario: async () => scenario, recalculateScenario: async () => null, buildForecast, logError: vi.fn() }));
  await request(conflictApp).post('/api/workspaces/0123456789abcdef01234567/orders/scenarios/0123456789abcdef01234568/recalculate').send({}).expect(409);
});
