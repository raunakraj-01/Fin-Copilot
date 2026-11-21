import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import app from '../src/app.js';
import request from './authenticatedRequest.js';
import AuditEvent from '../src/models/AuditEvent.js';
import BankTransaction from '../src/models/BankTransaction.js';
import CashItem from '../src/models/CashItem.js';
import SyncDevice from '../src/models/SyncDevice.js';
import SyncRun from '../src/models/SyncRun.js';
import { tokenHash } from '../src/services/auth.js';
import { hashPassword } from '../src/services/auth.js';
import User from '../src/models/User.js';
import CollectionFollowUp from '../src/models/CollectionFollowUp.js';
import CollectionAction from '../src/models/CollectionAction.js';

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); }, 600000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

async function workspace(name) {
  return (await request(app).post('/api/workspaces').send({ name, asOfDate: '2026-11-01', openingCashPaise: 100000, minimumReservePaise: 10000 }).expect(201)).body.workspace;
}
async function tallyDevice(workspaceId) {
  const token = `hsb_sync_${randomUUID()}_${randomUUID()}`;
  await SyncDevice.create({ workspaceId, name: 'Roadmap test device', kind: 'sync', tokenHash: tokenHash(token), tokenPrefix: token.slice(0, 17) });
  return token;
}
function tallyRow({ sourceId = 'v-1', version = 'v1', amountPaise = 50000, dueDate = '2026-11-20' } = {}) {
  return { sourceId, version, item: { category: 'receivable', externalId: `INV-${sourceId}`, counterparty: 'Acme Ltd',
    sourceSystem: 'tally_export', amountPaise, settledPaise: 0, status: 'open', dueDate, expectedDate: dueDate, confidenceState: 'verified' } };
}

it('records sync run success/errors and leaves changed Tally rows for owner review', async () => {
  const business = await workspace('Sync review');
  const base = `/api/workspaces/${business.id}`;
  const token = await tallyDevice(business.id);
  const postBatch = rows => request(app).post(`${base}/sync/batches`).set('Authorization', `Bearer ${token}`).send({ companyId: 'Main Co', batchId: randomUUID(), rows });
  await postBatch([tallyRow()]).expect(200);
  await postBatch([tallyRow({ version: 'v2', amountPaise: 60000, dueDate: '2026-11-25' })]).expect(200);
  const status = await request(app).get(`${base}/sync/status`).expect(200);
  expect(status.body.pendingChanges).toBe(1);
  const changes = await request(app).get(`${base}/sync/changes`).expect(200);
  expect(changes.body.changes[0]).toMatchObject({ kind: 'changed', sourceId: 'v-1', proposedItem: { amountPaise: 60000 } });
  await request(app).post(`${base}/sync/changes/${changes.body.changes[0].id}/resolve`).send({ decision: 'accept' }).expect(200);
  expect((await CashItem.findOne({ workspaceId: business.id, tallySourceId: 'v-1' })).amountPaise).toBe(60000);
  await postBatch([{ sourceId: 'v-1', version: 'deleted-v3', deleted: true }]).expect(200);
  const deletion = (await request(app).get(`${base}/sync/changes`).expect(200)).body.changes[0];
  expect(deletion.kind).toBe('deleted');
  await request(app).post(`${base}/sync/changes/${deletion.id}/resolve`).send({ decision: 'keep_current' }).expect(200);
  expect((await CashItem.findOne({ workspaceId: business.id, tallySourceId: 'v-1' })).status).toBe('open');
  await postBatch([tallyRow({ sourceId: 'v-backdated', version: 'v1', dueDate: '2026-10-30' })]).expect(200);
  const backdated = (await request(app).get(`${base}/sync/changes`).expect(200)).body.changes[0];
  expect(backdated.kind).toBe('backdated');
  await request(app).post(`${base}/sync/changes/${backdated.id}/resolve`).send({ decision: 'accept' }).expect(200);
  expect(await CashItem.exists({ workspaceId: business.id, tallySourceId: 'v-backdated' })).toBeTruthy();
  const runId = randomUUID();
  await request(app).post(`${base}/sync/runs`).set('Authorization', `Bearer ${token}`).send({ runId, companyId: 'Main Co', status: 'failed',
    errorCode: 'TALLY_UNAVAILABLE', errorMessage: 'Tally local XML server is unavailable' }).expect(202);
  const failed = await request(app).get(`${base}/sync/status`).expect(200);
  expect(failed.body.actionableError.message).toContain('Tally local XML server');
  await request(app).post(`${base}/sync/runs`).set('Authorization', `Bearer ${token}`).send({ runId: randomUUID(), companyId: 'Main Co', status: 'succeeded', appliedCount: 1 }).expect(202);
  const succeeded = await request(app).get(`${base}/sync/status`).expect(200);
  expect(succeeded.body.lastSuccessfulAt).toBeTruthy();
  expect(await SyncRun.countDocuments({ workspaceId: business.id })).toBe(2);
});

it('matches bank debits to supplier records once, including partial settlements and forecast dates', async () => {
  const business = await workspace('Debit matching');
  const base = `/api/workspaces/${business.id}`;
  const bill = (await request(app).post(`${base}/items`).send({ category: 'payable', externalId: 'BILL-1', counterparty: 'Steel supplier',
    amountPaise: 10000, dueDate: '2026-11-15', expectedDate: '2026-11-15', confidenceState: 'verified' }).expect(201)).body.item;
  const transaction = await BankTransaction.create({ workspaceId: business.id, accountKey: 'Main', transactionId: 'UTR-DEBIT-1', identity: randomUUID(),
    date: '2026-11-03', description: 'Steel supplier BILL-1', creditPaise: 0, debitPaise: 6000 });
  const body = { requestId: randomUUID(), cashItemId: bill.id, amountPaise: 4000 };
  await request(app).post(`${base}/bank/${transaction.id}/match-debit`).send(body).expect(200);
  expect((await request(app).post(`${base}/bank/${transaction.id}/match-debit`).send(body).expect(200)).body.duplicate).toBe(true);
  const updated = await CashItem.findById(bill.id);
  expect(updated.settledPaise).toBe(4000);
  expect(updated.settlementEvents[0]).toMatchObject({ direction: 'payment', date: '2026-11-03', amountPaise: 4000 });
  const forecast = (await request(app).get(`${base}/forecast`).expect(200)).body;
  expect(forecast.daily.find(day => day.date === '2026-11-03').paymentsPaise).toBe(4000);
  expect(forecast.daily.find(day => day.date === '2026-11-15').paymentsPaise).toBe(6000);
  await request(app).patch(`${base}/items/${bill.id}`).send({ settledPaise: 0, status: 'open' }).expect(409);
});

it('keeps timing suggestions inside one business and applies them only after owner confirmation', async () => {
  const business = await workspace('Timing source');
  const base = `/api/workspaces/${business.id}`;
  const historical = [2, 4, 8].map((late, index) => ({ workspaceId: business.id, category: 'receivable', counterparty: 'Acmé Private Ltd.',
    amountPaise: 5000, settledPaise: 5000, status: 'paid', sourceSystem: 'tally_export', dueDate: `2026-10-${String(10 + index).padStart(2, '0')}`,
    expectedDate: `2026-10-${String(10 + index).padStart(2, '0')}`, confidenceState: 'verified', settlementEvents: [{ source: 'bank', sourceId: `hist-${index}`,
      direction: 'receipt', amountPaise: 5000, date: `2026-10-${String(10 + index + late).padStart(2, '0')}`,
      dueDate: `2026-10-${String(10 + index).padStart(2, '0')}`, completedInvoice: true, verified: true }] }));
  await CashItem.insertMany(historical);
  const invoice = (await request(app).post(`${base}/items`).send({ category: 'receivable', externalId: 'INV-OPEN', counterparty: 'ACME private ltd',
    amountPaise: 8000, dueDate: '2026-11-20', expectedDate: '2026-11-21', confidenceState: 'owner_assumption' }).expect(201)).body.item;
  const suggestion = await request(app).get(`${base}/reliability/payment-timing/${invoice.id}`).expect(200);
  expect(suggestion.body).toMatchObject({ available: true, expectedDate: '2026-11-24', medianDaysLate: 4, confidence: 'low', evidenceCount: 3, ownerExpectedDate: '2026-11-21' });
  const applied = await request(app).post(`${base}/reliability/payment-timing/${invoice.id}/apply`).send({ confirm: true, expectedDate: '2026-11-24' }).expect(200);
  expect(applied.body.applied).toBe(true);
  expect((await CashItem.findById(invoice.id)).expectedDate).toBe('2026-11-24');
  const other = await workspace('No shared timing');
  const otherInvoice = (await request(app).post(`/api/workspaces/${other.id}/items`).send({ category: 'receivable', counterparty: 'Acme Private Ltd', amountPaise: 1000,
    dueDate: '2026-11-20', expectedDate: '2026-11-21', confidenceState: 'verified' }).expect(201)).body.item;
  const unavailable = await request(app).get(`/api/workspaces/${other.id}/reliability/payment-timing/${otherInvoice.id}`).expect(200);
  expect(unavailable.body).toMatchObject({ available: false, evidenceCount: 0 });
  expect((await CashItem.findById(otherInvoice.id)).expectedDate).toBe('2026-11-21');
});

it('stores customer responses and disputes in the durable collection history', async () => {
  const business = await workspace('Collection actions');
  const base = `/api/workspaces/${business.id}`;
  const invoice = (await request(app).post(`${base}/items`).send({ category: 'receivable', counterparty: 'Buyer', amountPaise: 9000,
    dueDate: '2026-11-15', expectedDate: '2026-11-15' }).expect(201)).body.item;
  const action = { cashItemId: invoice.id, requestId: randomUUID(), type: 'customer_response', note: 'Buyer asked for a copy of the invoice.' };
  await request(app).post(`${base}/followups/actions`).send(action).expect(201);
  await request(app).post(`${base}/followups/actions`).send({ ...action, requestId: randomUUID(), type: 'dispute', note: 'Buyer disputes the delivery quantity.' }).expect(201);
  const history = await request(app).get(`${base}/followups/actions?cashItemId=${invoice.id}`).expect(200);
  expect(history.body.actions.map(value => value.type).sort()).toEqual(['customer_response', 'dispute']);
});

it('exports business records and keeps audit entries append-only', async () => {
  const business = await workspace('Trust foundation');
  const base = `/api/workspaces/${business.id}`;
  await request(app).post(`${base}/items`).send({ category: 'expense', counterparty: 'Power', amountPaise: 1000, dueDate: '2026-11-20', expectedDate: '2026-11-20' }).expect(201);
  const events = await request(app).get(`${base}/trust/audit`).expect(200);
  expect(events.body.events.some(event => event.action.includes('POST items'))).toBe(true);
  const exportResult = await request(app).get(`${base}/trust/export`).expect(200);
  expect(exportResult.body).toMatchObject({ formatVersion: 1, workspace: { name: 'Trust foundation' } });
  expect(exportResult.body.cashItems).toHaveLength(1);
  const event = await AuditEvent.findOne({ workspaceId: business.id });
  await expect(AuditEvent.updateOne({ _id: event._id }, { $set: { action: 'rewritten' } })).rejects.toThrow('append-only');
});

it('generates one-use recovery codes and rejects a reused code', async () => {
  const user = await User.findOne({ email: 'regression-owner@example.test' });
  user.passwordHash = await hashPassword('old-password-is-long-enough');
  await user.save();
  const generated = await request(app).post('/api/auth/recovery-codes').send({ currentPassword: 'old-password-is-long-enough' }).expect(200);
  expect(generated.body.codes).toHaveLength(10);
  await request(app).post('/api/auth/recover').send({ email: user.email, recoveryCode: generated.body.codes[0], newPassword: 'new-password-is-long-enough' }).expect(200);
  await request(app).post('/api/auth/recover').send({ email: user.email, recoveryCode: generated.body.codes[0], newPassword: 'another-password-is-long' }).expect(400);
});

it('records idempotent WhatsApp provider status callbacks for the matching business message', async () => {
  const business = await workspace('Delivery status');
  const item = (await request(app).post(`/api/workspaces/${business.id}/items`).send({ category: 'receivable', counterparty: 'Buyer', amountPaise: 5000,
    dueDate: '2026-11-20', expectedDate: '2026-11-20' }).expect(201)).body.item;
  const providerMessageId = `wamid.${randomUUID()}`;
  const rule = await CollectionFollowUp.create({ workspaceId: business.id, cashItemId: item.id, phone: '919999999999', mode: 'n8n', recipientOptIn: true,
    state: 'active', cadenceDays: 3, maxAttempts: 3, attempts: 1, nextRunAt: new Date(), history: [{ at: new Date(), outcome: 'accepted',
      message: 'Invoice reminder', providerMessageId }] });
  const token = `hsb_automation_${randomUUID()}`;
  await SyncDevice.create({ workspaceId: business.id, name: 'Automation callback', kind: 'automation', tokenHash: tokenHash(token), tokenPrefix: token.slice(0, 17) });
  const prior = process.env.FOLLOWUP_ALLOW_SEND;
  process.env.FOLLOWUP_ALLOW_SEND = '1';
  try {
    const path = `/api/followup-automation/messages/${encodeURIComponent(providerMessageId)}/status`;
    await request(app).post(path).set('Authorization', `Bearer ${token}`).send({ status: 'delivered' }).expect(200);
    const duplicate = await request(app).post(path).set('Authorization', `Bearer ${token}`).send({ status: 'delivered' }).expect(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect(await CollectionAction.countDocuments({ workspaceId: business.id, providerMessageId, status: 'delivered' })).toBe(1);
    expect((await CollectionFollowUp.findById(rule._id)).history.at(-1).outcome).toBe('delivered');
    await request(app).post(`/api/followup-automation/messages/unknown/status`).set('Authorization', `Bearer ${token}`).send({ status: 'read' }).expect(404);
  } finally {
    if (prior === undefined) delete process.env.FOLLOWUP_ALLOW_SEND;
    else process.env.FOLLOWUP_ALLOW_SEND = prior;
  }
});
