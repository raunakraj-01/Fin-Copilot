import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import CashItem from '../src/models/CashItem.js';
import ImportBatch from '../src/models/ImportBatch.js';
import { parseUpload, suggestMapping } from '../src/services/imports/parse.js';
import { normalizeRows } from '../src/services/imports/normalize.js';
let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Promise.all([CashItem.init(), ImportBatch.init()]); }, 600000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
async function setup() {
  return `/api/workspaces/${(await request(app).post('/api/workspaces').send({ name: 'Reliable imports', asOfDate: '2026-11-01', openingCashPaise: 0 }).expect(201)).body.workspace.id}`;
}
async function inspect(base, buffer, name = 'invoices.csv') {
  const inspected = (await request(app).post(`${base}/imports/inspect`).field('kind', 'receivables').attach('file', buffer, name).expect(201)).body;
  await request(app).post(`${base}/imports/${inspected.batchId}/validate`).send({ mapping: inspected.suggestedMapping }).expect(200);
  return `${base}/imports/${inspected.batchId}/commit`;
}
const csv = (id = 'INV-A', amount = '100') => Buffer.from(`Invoice ID,Customer,Amount,Due Date,Expected Date\n${id},Buyer,${amount},2026-11-10,2026-11-10\n`);

it('deduplicates invoice IDs across CSV/XLSX and reports changed duplicates without overwriting', async () => {
  const base = await setup();
  const buffer = await readFile(new URL('./fixtures/receivables.xlsx', import.meta.url));
  const parsed = await parseUpload({ originalname: 'invoices.xlsx', buffer });
  const item = normalizeRows(parsed.rawRows, suggestMapping(parsed.headers), 'receivables', 'excel')[0].item;
  await request(app).post(await inspect(base, buffer, 'invoices.xlsx')).send({}).expect(200);
  const second = Buffer.from(`Invoice ID,Customer,Amount,Due Date,Expected Date\n${item.externalId},${item.counterparty},${item.amountPaise / 100},${item.dueDate},${item.expectedDate}\n`);
  const summary = (await request(app).post(await inspect(base, second)).send({}).expect(200)).body;
  expect(summary.savedCount).toBe(0); expect(summary.duplicateConflicts).toHaveLength(1);
  const stored = (await request(app).get(`${base}/items`)).body.items[0];
  await request(app).patch(`${base}/items/${stored.id}`).send({ settledPaise: 1000, status: 'partial' }).expect(200);
  const changed = (await request(app).post(await inspect(base, second, 'renamed.csv')).send({}).expect(200)).body;
  expect(changed.duplicateConflicts[0].changed).toBe(true);
  expect((await request(app).get(`${base}/items`)).body.items).toHaveLength(1);
  expect((await CashItem.findById(stored.id)).settledPaise).toBe(1000);
});

it('bounds concurrent imports of the same invoice and concurrent commits of one batch', async () => {
  const base = await setup();
  const paths = await Promise.all([inspect(base, csv()), inspect(base, csv(' inv-a '))]);
  const results = await Promise.all(paths.map(path => request(app).post(path).send({})));
  expect(results.every(r => r.status === 200)).toBe(true);
  expect(results.reduce((s, r) => s + r.body.savedCount, 0)).toBe(1);
  expect((await request(app).get(`${base}/items`)).body.items).toHaveLength(1);
  const path = await inspect(base, csv('INV-B'));
  const commits = await Promise.all([request(app).post(path).send({}), request(app).post(path).send({})]);
  expect(commits.every(r => [200, 409].includes(r.status))).toBe(true);
  expect((await request(app).post(path).send({}).expect(200)).body.savedCount).toBe(1);
  expect((await request(app).get(`${base}/items`)).body.items).toHaveLength(2);
});

it('resumes a partially written import with frozen reviewed rows and stable saved counts', async () => {
  const base = await setup();
  const buffer = Buffer.from('Invoice ID,Customer,Amount,Due Date,Expected Date\nINV-A,Buyer,0.29,2026-11-10,2026-11-10\nINV-B,Buyer,100,2026-11-10,2026-11-10\n');
  const path = await inspect(base, buffer);
  const original = CashItem.updateOne.bind(CashItem); let calls = 0;
  const spy = vi.spyOn(CashItem, 'updateOne').mockImplementation((...args) => ++calls === 2 ? Promise.reject(new Error('interrupted import')) : original(...args));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await request(app).post(path).send({}).expect(500);
  spy.mockRestore();
  expect((await request(app).get(`${base}/items`)).body.items).toHaveLength(1);
  await request(app).post(path).send({ excludedRowNumbers: [2] }).expect(409);
  const retried = (await request(app).post(path).send({}).expect(200)).body;
  expect(retried.savedCount).toBe(2); expect(retried.duplicateConflicts).toEqual([]);
  const rows = (await request(app).get(`${base}/items`)).body.items;
  expect(rows).toHaveLength(2); expect(rows.find(i => i.externalId === 'INV-A').amountPaise).toBe(29);
});

it('rejects corrections to nonexistent rows and scopes batch access to its workspace', async () => {
  const base = await setup(); const path = await inspect(base, csv());
  await request(app).post(path).send({ excludedRowNumbers: [99] }).expect(400);
  await request(app).post(path).send({ corrections: [{ rowNumber: 2, values: {} }, { rowNumber: 2, values: {} }] }).expect(400);
  const other = await setup();
  await request(app).post(`${other}/imports/${path.split('/').at(-2)}/commit`).send({}).expect(404);
});
