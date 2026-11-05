import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import app from '../src/app.js';
import CashItem from '../src/models/CashItem.js';
import { buildForecast } from '../src/services/finance/forecast.js';
import { delayReceipts } from '../src/services/finance/shock.js';

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); }, 600000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

async function setup() {
  const workspace = (await request(app).post('/api/workspaces').send({ name: 'Promise pilot', asOfDate: '2026-11-01', openingCashPaise: 10000, minimumReservePaise: 5000 }).expect(201)).body.workspace;
  const base = `/api/workspaces/${workspace.id}`;
  const invoice = (await request(app).post(`${base}/items`).send({ category: 'receivable', counterparty: 'Buyer', externalId: 'INV-P', amountPaise: 60000,
    dueDate: '2026-11-02', expectedDate: '2026-11-10' }).expect(201)).body.item;
  await request(app).post(`${base}/items`).send({ category: 'payable', counterparty: 'Wages', externalId: 'WAGES', amountPaise: 40000,
    dueDate: '2026-11-05', expectedDate: '2026-11-05', constraints: { mandatory: true } }).expect(201);
  return { base, invoice, path: `${base}/items/${invoice.id}/promises` };
}
const terms = (amountPaise, promisedDate = '2026-11-03') => ({ amountPaise, promisedDate, note: 'Customer confirmed' });

it('splits promises without duplicate income and exposes wages if a promise is missed', async () => {
  const { base, path } = await setup();
  await request(app).post(path).send(terms(40000)).expect(201);
  await request(app).post(path).send(terms(20000, '2026-11-09')).expect(201);
  const forecast = (await request(app).get(`${base}/forecast`).expect(200)).body;
  expect(forecast.daily.reduce((sum, d) => sum + d.receiptsPaise, 0)).toBe(60000);
  expect(forecast.daily.find(d => d.date === '2026-11-03').receiptsPaise).toBe(40000);
  expect(forecast.promiseRisks[0].affectedPayments[0]).toMatchObject({ label: 'WAGES', date: '2026-11-05', gapPaise: 35000 });
  await request(app).post(path).send(terms(1)).expect(400);
  const order = await request(app).post(`${base}/orders/analyze`).send({ orderValuePaise: 10000, advancePaise: 0,
    advanceDate: '2026-11-02', finalCollectionDate: '2026-11-20', costLines: [] }).expect(200);
  expect(order.body.baseline.daily.find(d => d.date === '2026-11-03').receiptsPaise).toBe(40000);
});

it('detects broken promises by snapshot date and retains broken history on revision', async () => {
  const { base, path } = await setup();
  const p = (await request(app).post(path).send(terms(40000)).expect(201)).body.promises[0];
  await request(app).patch(base).send({ asOfDate: '2026-11-04' }).expect(200);
  const list = (await request(app).get(`${base}/promises`).expect(200)).body;
  expect(list.items.find(i => i.promises.length).promises[0].status).toBe('broken');
  let forecast = (await request(app).get(`${base}/forecast`).expect(200)).body;
  expect(forecast.daily.reduce((s, d) => s + d.receiptsPaise, 0)).toBe(20000);
  expect(forecast.promiseRisks[0].affectedPayments[0].label).toBe('WAGES');
  await request(app).patch(`${path}/${p.id}`).send(terms(40000, '2026-11-06')).expect(200);
  const revised = (await request(app).get(`${base}/promises`)).body.items.find(i => i.promises.length).promises;
  expect(revised[0]).toMatchObject({ status: 'superseded', promisedDate: '2026-11-03' });
  expect(revised[0].history.at(-1).statusBefore).toBe('broken');
  expect(revised[1].promisedDate).toBe('2026-11-06');
  forecast = (await request(app).get(`${base}/forecast`)).body;
  expect(forecast.daily.find(d => d.date === '2026-11-06').receiptsPaise).toBe(40000);
  expect(forecast.daily.reduce((s, d) => s + d.receiptsPaise, 0)).toBe(60000);
});

it('confirms partial receipts once, adjusts the ledger and preserves late-payment history', async () => {
  const { base, invoice, path } = await setup();
  const p = (await request(app).post(path).send(terms(60000)).expect(201)).body.promises[0];
  const body = { amountPaise: 10000, receivedDate: '2026-11-02', requestId: randomUUID() };
  await request(app).post(`${path}/${p.id}/receipts`).send(body).expect(200);
  await request(app).post(`${path}/${p.id}/receipts`).send(body).expect(200);
  await request(app).post(`${path}/${p.id}/receipts`).send({ ...body, amountPaise: 20000 }).expect(409);
  let stored = await CashItem.findById(invoice.id).lean();
  expect(stored.settledPaise).toBe(10000);
  expect(stored.status).toBe('partial');
  expect(stored.gatewayReceipts).toHaveLength(1);
  let forecast = (await request(app).get(`${base}/forecast`)).body;
  expect(forecast.daily.reduce((s, d) => s + d.receiptsPaise, 0)).toBe(60000);
  expect(forecast.daily.find(d => d.date === '2026-11-03').receiptsPaise).toBe(50000);
  await request(app).patch(base).send({ asOfDate: '2026-11-04', openingCashPaise: 20000 }).expect(200);
  await request(app).post(`${path}/${p.id}/receipts`).send({ amountPaise: 50001, receivedDate: '2026-11-04', requestId: randomUUID() }).expect(400);
  const full = (await request(app).post(`${path}/${p.id}/receipts`).send({ amountPaise: 50000, receivedDate: '2026-11-04', requestId: randomUUID() }).expect(200)).body;
  expect(full.promises[0].status).toBe('fulfilled');
  expect(full.promises[0].history.at(-1).statusBefore).toBe('broken');
  stored = await CashItem.findById(invoice.id).lean();
  expect(stored.status).toBe('paid');
  forecast = (await request(app).get(`${base}/forecast`)).body;
  expect(forecast.daily.reduce((s, d) => s + d.receiptsPaise, 0)).toBe(0); // snapshot already contains old cash
});

it('validates dates, amounts, closed promises and workspace isolation', async () => {
  const { base, invoice, path } = await setup();
  for (const data of [terms(0), terms(1.5), terms(10, '2026-02-30'), terms(10, '2026-11-01'), { ...terms(10), arbitrary: true }])
    await request(app).post(path).send(data).expect(400);
  const p = (await request(app).post(path).send(terms(30000)).expect(201)).body.promises[0];
  const other = await setup();
  await request(app).patch(`${other.base}/items/${invoice.id}/promises/${p.id}`).send(terms(1)).expect(404);
  await request(app).post(`${path}/${p.id}/cancel`).send({ note: 'Customer withdrew' }).expect(200);
  await request(app).patch(`${path}/${p.id}`).send(terms(1)).expect(409);
  const forecast = (await request(app).get(`${base}/forecast`)).body;
  expect(forecast.daily.find(d => d.date === '2026-11-10').receiptsPaise).toBe(60000);
  expect(forecast.promiseRisks).toEqual([]);
});

it('does not double-confirm simultaneous receipts', async () => {
  const { path, invoice } = await setup();
  const p = (await request(app).post(path).send(terms(60000)).expect(201)).body.promises[0];
  const body = { amountPaise: 60000, receivedDate: '2026-11-03', requestId: randomUUID() };
  const results = await Promise.all([request(app).post(`${path}/${p.id}/receipts`).send(body), request(app).post(`${path}/${p.id}/receipts`).send(body)]);
  expect(results.every(r => [200, 409].includes(r.status))).toBe(true);
  expect((await CashItem.findById(invoice.id)).settledPaise).toBe(60000);
});

it('flags externally recorded settlements for review instead of overstating broken promises', async () => {
  const { base, invoice, path } = await setup();
  await request(app).post(path).send(terms(60000)).expect(201);
  await request(app).patch(`${base}/items/${invoice.id}`).send({ settledPaise: 50000, status: 'partial' }).expect(200);
  await request(app).patch(base).send({ asOfDate: '2026-11-04' }).expect(200);
  const list = (await request(app).get(`${base}/promises`)).body;
  expect(list.items.find(i => i.promises.length).promises[0]).toMatchObject({ status: 'review_external_settlement', forecastPaise: 10000 });
  const forecast = (await request(app).get(`${base}/forecast`)).body;
  expect(forecast.promiseRisks[0].amountPaise).toBe(10000);
  expect(forecast.daily.reduce((s, d) => s + d.receiptsPaise, 0)).toBe(0);
  await request(app).patch(`${base}/items/${invoice.id}`).send({ settledPaise: 60000, status: 'paid' }).expect(200);
  expect((await request(app).get(`${base}/forecast`)).body.promiseRisks).toEqual([]);
});

it('keeps needs-review promises excluded, caps legacy settlements and delays installments in shock scenarios', () => {
  const item = { id: 'r', category: 'receivable', status: 'open', amountPaise: 60000, settledPaise: 0,
    counterparty: 'Buyer', expectedDate: '2026-11-10', paymentPromises: [{ id: 'p', amountPaise: 40000, receivedPaise: 0, promisedDate: '2026-11-03' }] };
  const context = { asOfDate: '2026-11-01', openingCashPaise: 0, horizonDays: 20 };
  const review = buildForecast({ ...context, cashItems: [{ ...item, confidenceState: 'needs_review' }] });
  expect(review.daily.every(d => d.receiptsPaise === 0)).toBe(true);
  expect(review.promiseRisks).toEqual([]);
  const reduced = buildForecast({ ...context, cashItems: [{ ...item, settledPaise: 50000, status: 'partial' }] });
  expect(reduced.daily.reduce((s, d) => s + d.receiptsPaise, 0)).toBe(10000);
  const shifted = delayReceipts([item], 'Buyer', 7, context.asOfDate);
  expect(shifted[0].paymentPromises[0].promisedDate).toBe('2026-11-10');
  const forecast = buildForecast({ ...context, cashItems: shifted });
  expect(forecast.daily.find(d => d.date === '2026-11-03').receiptsPaise).toBe(0);
  expect(forecast.daily.find(d => d.date === '2026-11-10').receiptsPaise).toBe(40000);
  const oldDate = { ...item, expectedDate: '2026-10-30' };
  expect(delayReceipts([oldDate], 'Buyer', 7, context.asOfDate)[0].paymentPromises[0].promisedDate).toBe('2026-11-10');
});

it('reruns rescue against promise-aware cash and excludes incompatible invoice-wide collection actions', async () => {
  const { base, path, invoice } = await setup();
  await request(app).patch(`${base}/items/${invoice.id}`).send({ constraints: { earliestCollectionDate: '2026-11-02', maxEarlyCollectionPaise: 60000 } }).expect(200);
  const promise = (await request(app).post(path).send(terms(60000)).expect(201)).body.promises[0];
  const rescue = (await request(app).post(`${base}/rescue/analyze`).send({ objective: 'minimum_reserve' }).expect(200)).body;
  expect(rescue.baseline.daily.find(d => d.date === '2026-11-03').receiptsPaise).toBe(60000);
  expect(rescue.baseline.daily.find(d => d.date === '2026-11-03').events[0].promiseId).toBe(promise.id);
  expect([...rescue.plans, ...rescue.partialMitigations].flatMap(p => p.actions).some(a => a.type === 'accelerate_collection')).toBe(false);
  const shock = (await request(app).post(`${base}/shock/analyze`).send({ counterparty: 'Buyer', delayDays: 7 }).expect(200)).body;
  expect(shock.stressed.daily.find(d => d.date === '2026-11-03').receiptsPaise).toBe(0);
  expect(shock.stressed.daily.find(d => d.date === '2026-11-10').receiptsPaise).toBe(60000);
});
