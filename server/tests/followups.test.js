import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import app from '../src/app.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import CollectionFollowUp from '../src/models/CollectionFollowUp.js';
import { recommendCollections, runFollowups, validateDispatch, finishFollowup, reconcileFollowups } from '../src/services/finance/followups.js';

let mongo, workspaceId, item, path;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); }, 600000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  vi.stubEnv('FEATURE_ADMIN_TOKEN', 'owner'); vi.stubEnv('FOLLOWUP_ALLOW_SEND', '0');
  workspaceId = String((await Workspace.create({ name: 'Follow-up fixture', asOfDate: '2026-11-01', openingCashPaise: 100000 }))._id);
  item = await CashItem.create({ workspaceId, category: 'receivable', externalId: 'INV-1', counterparty: 'Demo buyer',
    sourceSystem: 'manual', amountPaise: 100000, dueDate: '2026-10-25', expectedDate: '2026-11-20', confidenceState: 'verified' });
  path = `/api/workspaces/${workspaceId}/followups`;
});
const input = () => ({ cashItemId: String(item._id), phone: '+919999999999', cadenceDays: 3, maxAttempts: 3 });
const schedule = async extra => (await request(app).post(path).set('Authorization', 'Bearer owner').send({ ...input(), ...extra }).expect(201)).body.rule;

it('requires owner access and rejects live mode when it is not configured', async () => {
  await request(app).get(path).expect(401);
  await request(app).post(path).set('Authorization', 'Bearer owner').send({ ...input(), mode: 'n8n', recipientOptIn: true }).expect(400);
  await request(app).post('/api/followup-automation/claim').expect(401);
});
it('recommends overdue invoices and excludes paid and other-workspace records', async () => {
  const result = await request(app).get(path).set('Authorization', 'Bearer owner').expect(200);
  expect(result.body.suggestions).toHaveLength(1);
  expect(result.body.suggestions[0]).toMatchObject({ kind: 'overdue', overdueDays: 7, outstandingPaise: 100000 });
  expect(result.body.suggestions[0].message).toContain('INR 1,000.00');
  await CashItem.updateOne({ _id: item._id }, { status: 'paid', settledPaise: 100000 });
  const paid = await request(app).get(path).set('Authorization', 'Bearer owner').expect(200);
  expect(paid.body.suggestions).toEqual([]);
  expect(paid.body.receivables).toEqual([]);
});
it('identifies permitted early collections that improve the calculated cash gap', () => {
  const context = { asOfDate: '2026-11-01', openingCashPaise: 10000, minimumReservePaise: 0, cashItems: [
    { id: 'r', category: 'receivable', status: 'open', counterparty: 'Early buyer', amountPaise: 30000, settledPaise: 0, dueDate: '2026-11-25', expectedDate: '2026-11-25',
      constraints: { earliestCollectionDate: '2026-11-02', maxEarlyCollectionPaise: 15000, estimatedActionCostPaise: 0 } },
    { id: 'p', category: 'payable', status: 'open', amountPaise: 20000, settledPaise: 0, dueDate: '2026-11-05', expectedDate: '2026-11-05' },
  ], recurringRules: [] };
  const recommendation = recommendCollections(context).suggestions[0];
  expect(recommendation).toMatchObject({ kind: 'cash_shortage', gapReductionPaise: 10000 });
  expect(recommendation.message).toContain('INR 150.00');
});
it('generates local drafts, respects cadence, and never calls an external API', async () => {
  const rule = await schedule();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External sends prohibited in demo'); }));
  await runFollowups({ workspaceId });
  const drafted = await CollectionFollowUp.findById(rule._id);
  expect(drafted.attempts).toBe(1);
  expect(drafted.lastOutcome).toBe('draft_ready');
  expect(drafted.history).toHaveLength(1);
  expect(drafted.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 2 * 86400000);
  await runFollowups({ workspaceId });
  expect((await CollectionFollowUp.findById(rule._id)).attempts).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
});
it('stops follow-ups after settlement and respects manual pauses and attempt caps', async () => {
  const rule = await schedule({ maxAttempts: 1 });
  await runFollowups({ workspaceId });
  expect((await CollectionFollowUp.findById(rule._id)).state).toBe('exhausted');
  await schedule();
  await CashItem.updateOne({ _id: item._id }, { status: 'paid', settledPaise: 100000 });
  await runFollowups({ workspaceId });
  expect((await CollectionFollowUp.findById(rule._id)).state).toBe('paid');
  expect((await CollectionFollowUp.findById(rule._id)).attempts).toBe(0);
  await CashItem.updateOne({ _id: item._id }, { status: 'open', settledPaise: 0 });
  await schedule();
  await request(app).patch(`${path}/${rule._id}`).set('Authorization', 'Bearer owner').send({ state: 'paused' }).expect(200);
  await runFollowups({ workspaceId });
  expect((await CollectionFollowUp.findById(rule._id)).attempts).toBe(0);
});
it('prevents cross-workspace access to follow-up controls', async () => {
  const rule = await schedule();
  const other = await Workspace.create({ name: 'Other', asOfDate: '2026-11-01', openingCashPaise: 0 });
  await request(app).patch(`/api/workspaces/${other._id}/followups/${rule._id}`).set('Authorization', 'Bearer owner').send({ state: 'paused' }).expect(404);
});
it('claims each live job once, validates each dispatch once, and records callbacks once', async () => {
  vi.stubEnv('FOLLOWUP_ALLOW_SEND', '1'); vi.stubEnv('FOLLOWUP_AUTOMATION_TOKEN', 'automation-secret');
  const rule = await schedule({ mode: 'n8n', recipientOptIn: true });
  const batches = await Promise.all([runFollowups({ mode: 'n8n', workspaceId }), runFollowups({ mode: 'n8n', workspaceId })]);
  const jobs = batches.flat();
  expect(jobs).toHaveLength(1);
  const job = jobs[0];
  expect(await validateDispatch(job.claimId)).toMatchObject({ phone: '919999999999' });
  expect(await validateDispatch(job.claimId)).toBeNull();
  await finishFollowup(job.claimId, 'accepted', 'wamid.demo');
  expect(await finishFollowup(job.claimId, 'accepted', 'wamid.demo')).toBeNull();
  const saved = await CollectionFollowUp.findById(rule._id);
  expect(saved.attempts).toBe(1);
  expect(saved.history).toHaveLength(1);
  expect(saved.lastOutcome).toBe('accepted');
});
it('rechecks payment before an external dispatch and pauses failed sends', async () => {
  vi.stubEnv('FOLLOWUP_ALLOW_SEND', '1'); vi.stubEnv('FOLLOWUP_AUTOMATION_TOKEN', 'automation-secret');
  const rule = await schedule({ mode: 'n8n', recipientOptIn: true });
  const [job] = await runFollowups({ mode: 'n8n', workspaceId });
  await CashItem.updateOne({ _id: item._id }, { status: 'paid', settledPaise: 100000 });
  expect(await validateDispatch(job.claimId)).toBeNull();
  expect((await CollectionFollowUp.findById(rule._id)).state).toBe('paid');
  await CashItem.updateOne({ _id: item._id }, { status: 'open', settledPaise: 0 });
  await schedule({ mode: 'n8n', recipientOptIn: true });
  const [next] = await runFollowups({ mode: 'n8n', workspaceId });
  await finishFollowup(next.claimId, 'failed');
  expect((await CollectionFollowUp.findById(rule._id)).state).toBe('paused');
});

it('stops settled schedules even when their next cycle is days away', async () => {
  const rule = await schedule();
  await runFollowups({ workspaceId });
  await CashItem.updateOne({ _id: item._id }, { status: 'paid', settledPaise: 100000 });
  await reconcileFollowups();
  expect((await CollectionFollowUp.findById(rule._id)).state).toBe('paid');
});

it('supports the exact authenticated claim, validate and acknowledgement workflow', async () => {
  vi.stubEnv('FOLLOWUP_ALLOW_SEND', '1'); vi.stubEnv('FOLLOWUP_AUTOMATION_TOKEN', 'workflow-token');
  const rule = await schedule({ mode: 'n8n', recipientOptIn: true });
  const claim = await request(app).post('/api/followup-automation/claim').set('Authorization', 'Bearer workflow-token').expect(200);
  const job = claim.body.jobs.find(job => job.invoice === 'INV-1' && job.message.includes('Demo buyer'));
  expect(job).toBeTruthy();
  const url = `/api/followup-automation/jobs/${job.claimId}`;
  const permission = await request(app).post(`${url}/validate`).set('Authorization', 'Bearer workflow-token').expect(200);
  expect(permission.body).toMatchObject({ send: true, phone: '919999999999' });
  const duplicate = await request(app).post(`${url}/validate`).set('Authorization', 'Bearer workflow-token').expect(200);
  expect(duplicate.body.send).toBe(false);
  const ack = await request(app).post(`${url}/ack`).set('Authorization', 'Bearer workflow-token')
    .send({ outcome: 'accepted', providerMessageId: 'wamid.fixture' }).expect(200);
  expect(ack.body.recorded).toBe(true);
  expect((await CollectionFollowUp.findById(rule._id)).lastOutcome).toBe('accepted');
});
