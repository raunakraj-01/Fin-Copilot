import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import BankTransaction from '../src/models/BankTransaction.js';
import ImportBatch from '../src/models/ImportBatch.js';
import CashItem from '../src/models/CashItem.js';
import { parseUpload } from '../src/services/imports/parse.js';
let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Promise.all([CashItem.init(), BankTransaction.init(), ImportBatch.init()]); }, 600000);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
async function setup(amountPaise = 10000) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  const workspace = (await request(app).post('/api/workspaces').send({ name: 'Bank matching pilot', asOfDate: '2026-11-01', openingCashPaise: 20000 }).expect(201)).body.workspace;
  const base = `/api/workspaces/${workspace.id}`;
  const invoice = (await request(app).post(`${base}/items`).send({ category: 'receivable', externalId: 'INV-001', counterparty: 'Buyer', amountPaise,
    dueDate: '2026-11-10', expectedDate: '2026-11-10' }).expect(201)).body.item;
  return { base, workspace, invoice };
}
const bankFile = (credit = '100', id = 'UTR-1', date = '2026-11-03') => Buffer.from(`Transaction ID,Date,Description,Credit,Debit\n${id},${date},Buyer INV-001,${credit},0\n`);
async function bankInspect(base, buffer = bankFile(), name = 'bank.csv', accountKey = 'Main account', mapping) {
  const inspected = (await request(app).post(`${base}/bank/imports/inspect`).field('accountKey', accountKey).attach('file', buffer, name).expect(201)).body;
  await request(app).post(`${base}/bank/imports/${inspected.batchId}/validate`).send({ mapping: mapping || inspected.suggestedMapping }).expect(200);
  return `${base}/bank/imports/${inspected.batchId}/commit`;
}
async function addBank(base, credit = '100', id = 'UTR-1', date = '2026-11-03') {
  await request(app).post(await bankInspect(base, bankFile(credit, id, date))).send({}).expect(200);
  return (await request(app).get(`${base}/bank`).expect(200)).body.transactions.find(t => t.transactionId === id);
}

it('deduplicates repeated and overlapping bank imports and preserves changed duplicates', async () => {
  const { base, workspace } = await setup();
  const path = await bankInspect(base);
  expect((await request(app).post(path).send({}).expect(200)).body.savedCount).toBe(1);
  expect((await request(app).post(path).send({}).expect(200)).body.alreadyCommitted).toBe(true);
  const repeat = await bankInspect(base, bankFile(), 'renamed.csv', ' main ACCOUNT ');
  expect((await request(app).post(repeat).send({}).expect(200)).body.savedCount).toBe(0);
  const changed = await bankInspect(base, bankFile('200'));
  const summary = (await request(app).post(changed).send({}).expect(200)).body;
  expect(summary.duplicateConflicts[0].changed).toBe(true);
  expect(await BankTransaction.countDocuments({ workspaceId: workspace.id })).toBe(1);
  expect((await BankTransaction.findOne({ workspaceId: workspace.id })).creditPaise).toBe(10000);
});

it('uses the same bank identity for XLSX and CSV exports', async () => {
  const { base, workspace } = await setup();
  const buffer = await readFile(new URL('./fixtures/receivables.xlsx', import.meta.url));
  const parsed = await parseUpload({ originalname: 'bank.xlsx', buffer });
  const headers = parsed.headers;
  const id = headers.find(h => h.toLowerCase().includes('invoice'));
  const date = headers.find(h => h.toLowerCase().includes('due'));
  const amount = headers.find(h => h.toLowerCase().includes('amount'));
  const description = headers.find(h => h.toLowerCase().includes('customer'));
  const mapping = { transactionId: id, date, creditInr: amount, ...(description ? { description } : {}) };
  const xlsx = await bankInspect(base, buffer, 'bank.xlsx', 'MAIN', mapping);
  await request(app).post(xlsx).send({}).expect(200);
  const r = parsed.rawRows[0].values;
  const csv = Buffer.from(`Transaction ID,Date,Description,Credit,Debit\n${r[id]},${r[date]},,${r[amount].replaceAll(',', '')},0\n`);
  const repeat = (await request(app).post(await bankInspect(base, csv, 'other.csv', 'MAIN')).send({}).expect(200)).body;
  expect(repeat.savedCount).toBe(0);
  expect(await BankTransaction.countDocuments({ workspaceId: workspace.id })).toBe(1);
});

it('matches partial payments across multiple invoices and retries without posting cash twice', async () => {
  const { base, invoice } = await setup(10000); const bank = await addBank(base, '150');
  const second = (await request(app).post(`${base}/items`).send({ category: 'receivable', externalId: 'INV-002', counterparty: 'Buyer', amountPaise: 10000, dueDate: '2026-11-10', expectedDate: '2026-11-10' })).body.item;
  const body = { requestId: randomUUID(), cashItemId: invoice.id, amountPaise: 6000 };
  await request(app).post(`${base}/bank/${bank.id}/match`).send(body).expect(200);
  expect((await request(app).post(`${base}/bank/${bank.id}/match`).send(body).expect(200)).body.duplicate).toBe(true);
  await request(app).post(`${base}/bank/${bank.id}/match`).send({ ...body, amountPaise: 6001 }).expect(409);
  await request(app).post(`${base}/bank/${bank.id}/match`).send({ requestId: randomUUID(), cashItemId: second.id, amountPaise: 9000 }).expect(200);
  expect((await CashItem.findById(invoice.id)).settledPaise).toBe(6000);
  expect((await CashItem.findById(second.id)).status).toBe('partial');
  const forecast = (await request(app).get(`${base}/forecast`)).body;
  expect(forecast.daily.find(d => d.date === '2026-11-03').receiptsPaise).toBe(15000);
  expect(forecast.daily.find(d => d.date === '2026-11-10').receiptsPaise).toBe(5000);
  expect(forecast.daily.reduce((s, d) => s + d.receiptsPaise, 0)).toBe(20000);
  expect((await request(app).get(`${base}/bank`)).body.transactions[0].availablePaise).toBe(0);
});

it('allocates a bank receipt to a promise and handles receipts already in the cash snapshot', async () => {
  const { base, invoice } = await setup(10000);
  const p = (await request(app).post(`${base}/items/${invoice.id}/promises`).send({ amountPaise: 10000, promisedDate: '2026-11-04' })).body.promises[0];
  const bank = await addBank(base, '30', 'UTR-PAST', '2026-11-01');
  await request(app).post(`${base}/bank/${bank.id}/match`).send({ requestId: randomUUID(), cashItemId: invoice.id, promiseId: p.id, amountPaise: 3000 }).expect(200);
  const stored = await CashItem.findById(invoice.id);
  expect(stored.paymentPromises[0].receivedPaise).toBe(3000);
  const forecast = (await request(app).get(`${base}/forecast`)).body;
  expect(forecast.openingCashPaise).toBe(20000);
  expect(forecast.daily.reduce((s, d) => s + d.receiptsPaise, 0)).toBe(7000);
  await request(app).patch(`${base}/items/${invoice.id}`).send({ settledPaise: 0, status: 'open' }).expect(409);
  await request(app).delete(`${base}/items/${invoice.id}`).expect(409);
});

it('rejects overpayments and cross-business matches while releasing invalid reservations', async () => {
  const one = await setup(5000); const other = await setup(); const bank = await addBank(one.base, '100');
  await request(app).post(`${one.base}/bank/${bank.id}/match`).send({ requestId: randomUUID(), cashItemId: one.invoice.id, amountPaise: 10001 }).expect(400);
  await request(app).post(`${one.base}/bank/${bank.id}/match`).send({ requestId: randomUUID(), cashItemId: one.invoice.id, amountPaise: 6000 }).expect(400);
  await request(app).post(`${one.base}/bank/${bank.id}/match`).send({ requestId: randomUUID(), cashItemId: other.invoice.id, amountPaise: 1000 }).expect(400);
  await request(app).post(`${other.base}/bank/${bank.id}/match`).send({ requestId: randomUUID(), cashItemId: other.invoice.id, amountPaise: 1000 }).expect(404);
  const current = (await request(app).get(`${one.base}/bank`)).body.transactions[0];
  expect(current.availablePaise).toBe(10000);
  expect((await CashItem.findById(one.invoice.id)).settledPaise).toBe(0);
});

it('bounds simultaneous allocations to a credit and safely retries competing invoice updates', async () => {
  const { base, invoice } = await setup(20000); const bank = await addBank(base, '100');
  const bodies = [1, 2].map(() => ({ requestId: randomUUID(), cashItemId: invoice.id, amountPaise: 8000 }));
  const results = await Promise.all(bodies.map(body => request(app).post(`${base}/bank/${bank.id}/match`).send(body)));
  expect(results.filter(r => r.status === 200)).toHaveLength(1);
  expect(results.every(r => [200, 409].includes(r.status))).toBe(true);
  expect((await CashItem.findById(invoice.id)).settledPaise).toBe(8000);
  expect((await request(app).get(`${base}/bank`)).body.transactions[0].availablePaise).toBe(2000);
});

it('recovers an interrupted final acknowledgment without duplicating the confirmed receipt', async () => {
  const { base, invoice } = await setup(); const bank = await addBank(base);
  const original = BankTransaction.updateOne.bind(BankTransaction);
  let calls = 0;
  const spy = vi.spyOn(BankTransaction, 'updateOne').mockImplementation((...args) => { if (++calls === 2) return Promise.reject(new Error('simulated interruption')); return original(...args); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const body = { requestId: randomUUID(), cashItemId: invoice.id, amountPaise: 10000 };
  await request(app).post(`${base}/bank/${bank.id}/match`).send(body).expect(500);
  expect((await CashItem.findById(invoice.id)).settledPaise).toBe(10000);
  spy.mockRestore();
  const pending = (await request(app).get(`${base}/bank`)).body.transactions[0];
  expect(pending.allocations[0].status).toBe('pending'); expect(pending.availablePaise).toBe(0);
  await request(app).post(`${base}/bank/${bank.id}/match`).send(body).expect(200);
  const stored = await CashItem.findById(invoice.id);
  expect(stored.gatewayReceipts).toHaveLength(1); expect(stored.settledPaise).toBe(10000);
  expect((await request(app).get(`${base}/bank`)).body.transactions[0].allocations[0].status).toBe('applied');
});

it('flags unmatched rows in forecasts/spending and allows documented review without silently posting them', async () => {
  const { base, invoice } = await setup(); const bank = await addBank(base);
  expect((await CashItem.findById(invoice.id)).settledPaise).toBe(0);
  expect((await request(app).get(`${base}/forecast`)).body.warnings.some(w => w.includes('unmatched'))).toBe(true);
  const check = `${base}/spending-check?commitmentsConfirmed=true`;
  expect((await request(app).get(check)).body.dataQuality.issues.some(i => i.code === 'BANK_REVIEW')).toBe(true);
  await request(app).patch(`${base}/bank/${bank.id}/review`).send({ state: 'excluded', note: '' }).expect(400);
  await request(app).patch(`${base}/bank/${bank.id}/review`).send({ state: 'excluded', note: 'Recorded in opening cash; not an invoice receipt' }).expect(200);
  expect((await request(app).get(check)).body.dataQuality.issues.some(i => i.code === 'BANK_REVIEW')).toBe(false);
  await request(app).patch(`${base}/bank/${bank.id}/review`).send({ state: 'open', note: 'Review again' }).expect(200);
  expect((await request(app).get(check)).body.dataQuality.issues.some(i => i.code === 'BANK_REVIEW')).toBe(true);
});

it('keeps competing credits from overpaying an invoice and releases a now-invalid pending allocation on retry', async () => {
  const { base, invoice } = await setup(10000);
  const banks = [await addBank(base, '80', 'UTR-A'), await addBank(base, '80', 'UTR-B')];
  const bodies = banks.map(() => ({ requestId: randomUUID(), cashItemId: invoice.id, amountPaise: 8000 }));
  const results = await Promise.all(banks.map((bank, i) => request(app).post(`${base}/bank/${bank.id}/match`).send(bodies[i])));
  expect(results.filter(r => r.status === 200)).toHaveLength(1);
  const failed = results.findIndex(r => r.status !== 200);
  expect([400, 409]).toContain(results[failed].status);
  if (results[failed].status === 409) await request(app).post(`${base}/bank/${banks[failed].id}/match`).send(bodies[failed]).expect(400);
  expect((await CashItem.findById(invoice.id)).settledPaise).toBe(8000);
  const list = (await request(app).get(`${base}/bank`)).body.transactions;
  expect(list.reduce((s, t) => s + t.availablePaise, 0)).toBe(8000);
});

it('requires bank-row correction/exclusion, prevents debit matching and preserves review history', async () => {
  const { base, invoice } = await setup();
  const file = Buffer.from('Transaction ID,Date,Description,Credit,Debit\n,03/11/2026,Bank fee,0,10\n');
  const path = await bankInspect(base, file);
  await request(app).post(path).send({}).expect(422);
  await request(app).post(path).send({ excludedRowNumbers: [99] }).expect(400);
  await request(app).post(path).send({ corrections: [{ rowNumber: 2, values: { transactionId: 'FEE-1', date: '2026-11-03' } }] }).expect(200);
  const bank = (await request(app).get(`${base}/bank`)).body.transactions[0];
  await request(app).post(`${base}/bank/${bank.id}/match`).send({ requestId: randomUUID(), cashItemId: invoice.id, amountPaise: 1000 }).expect(400);
  expect((await request(app).get(`${base}/forecast`)).body.warnings.some(w => w.includes('debit'))).toBe(true);
  await request(app).patch(`${base}/bank/${bank.id}/review`).send({ state: 'excluded', note: 'Fee entered as an expense separately' }).expect(200);
  expect((await BankTransaction.findById(bank.id)).reviewHistory).toHaveLength(1);
});

it('retains an imported bank credit’s pending reservation if its invoice mutation is interrupted', async () => {
  const { base, invoice } = await setup(); const bank = await addBank(base);
  const spy = vi.spyOn(CashItem, 'updateOne').mockRejectedValueOnce(new Error('invoice write interrupted'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const body = { requestId: randomUUID(), cashItemId: invoice.id, amountPaise: 10000 };
  await request(app).post(`${base}/bank/${bank.id}/match`).send(body).expect(500);
  spy.mockRestore();
  const pending = (await request(app).get(`${base}/bank`)).body.transactions[0];
  expect(pending.availablePaise).toBe(0); expect(pending.allocations[0].status).toBe('pending');
  expect((await CashItem.findById(invoice.id)).settledPaise).toBe(0);
  await request(app).patch(`${base}/bank/${bank.id}/review`).send({ state: 'excluded', note: 'Cannot discard pending funds' }).expect(409);
  await request(app).post(`${base}/bank/${bank.id}/match`).send(body).expect(200);
  expect((await CashItem.findById(invoice.id)).settledPaise).toBe(10000);
});
