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
}, 600_000);
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

it('seeds fixture records and runs the complete decision flow without changing cash items', async () => {
  const seed = async () => execFileAsync(process.execPath, ['src/seed/index.js'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, MONGODB_URI: mongo.getUri() },
  });
  await seed();
  await seed();
  const workspace = await Workspace.findById('650000000000000000000001');
  expect(workspace.openingCashPaise).toBe(20_000_000);
  expect(await CashItem.countDocuments({ workspaceId: workspace._id })).toBe(5);
  const base = `/api/workspaces/${workspace._id}`;
  const before = await CashItem.find({ workspaceId: workspace._id }).sort({ _id: 1 }).lean();
  const outlook = await request(app).get(`${base}/forecast`).expect(200);
  expect(outlook.body.risk.firstNegativeDate).toBe('2026-11-06');
  const rescue = await request(app).post(`${base}/rescue/analyze`)
    .send({ objective: 'nonnegative', maxCandidates: 12, maxPlans: 3 }).expect(200);
  expect(rescue.body.plans.length).toBeGreaterThan(0);
  const shock = await request(app).post(`${base}/shock/analyze`).send({ counterparty: 'Acme Retail Pvt Ltd', delayDays: 15 }).expect(200);
  expect(shock.body.priorities[0].remainingGapPaise).toBe(300_000);
  expect(shock.body.plans.every(plan => plan.scenarios.length === 3)).toBe(true);
  expect(shock.body.plans.some(plan => plan.scenarios.some(scenario => !scenario.passes))).toBe(true);
  const savedPlan = await request(app).post(`${base}/rescue/plans`)
    .send({ objective: 'nonnegative', actions: rescue.body.plans[0].actions }).expect(201);
  const plans = await request(app).get(`${base}/rescue/plans`).expect(200);
  expect(savedPlan.body.actions.every(action => !!action.feeDate)).toBe(true);
  expect(savedPlan.body.simulatedWorstCashPaise).toBe(rescue.body.plans[0].worstCashPaiseAfter);
  expect(plans.body.plans.some(plan => plan._id === savedPlan.body._id)).toBe(true);
  const actionId = savedPlan.body.actions[0].actionId;
  const tracked = await request(app).patch(`${base}/rescue/plans/${savedPlan.body._id}/actions/${actionId}`)
    .send({ status: 'requested', ownerNotes: 'Demo follow-up' }).expect(200);
  expect(tracked.body.actions[0].status).toBe('requested');
  const order = { label: 'Demo order', orderValuePaise: 80_000_000, advancePaise: 0,
    advanceDate: '2026-11-02', finalCollectionDate: '2026-12-31',
    costLines: [{ description: 'Materials', amountPaise: 50_000_000, paymentDate: '2026-11-11' }],
    delayedCollectionDays: 14 };
  const analysis = await request(app).post(`${base}/orders/analyze`).send(order).expect(200);
  const scenario = await request(app).post(`${base}/orders/scenarios`).send(order).expect(201);
  expect(scenario.body.simulatedMinimumAdvancePaise).toBe(analysis.body.minimumAdvance.amountPaise);
  const scenarios = await request(app).get(`${base}/orders/scenarios`).expect(200);
  expect(scenarios.body.scenarios.some(saved => saved._id === scenario.body._id)).toBe(true);
  expect(await CashItem.find({ workspaceId: workspace._id }).sort({ _id: 1 }).lean()).toEqual(before);
}, 60_000);

it('creates and corrects manual items and monthly expenses', async () => {
  const created = await request(app).post('/api/workspaces').send({ name: 'Manual test',
    asOfDate: '2026-11-01', openingCashPaise: 20_000_000, minimumReservePaise: 0 }).expect(201);
  const id = created.body.workspace.id;
  await request(app).patch(`/api/workspaces/${id}`).send({ minimumReservePaise: -1 }).expect(400);
  const changed = await request(app).patch(`/api/workspaces/${id}`).send({ minimumReservePaise: 10_000_000 }).expect(200);
  expect(changed.body.workspace.minimumReservePaise).toBe(10_000_000);
  const item = await request(app).post(`/api/workspaces/${id}/items`).send({ category: 'receivable',
    counterparty: 'Example buyer', amountPaise: 10_000_000, settledPaise: 0, status: 'open',
    dueDate: '2026-11-10', confidenceState: 'needs_review', constraints: {
      earliestCollectionDate: '2026-11-05', maxEarlyCollectionPaise: 5_000_000 } }).expect(201);
  expect(item.body.item.outstandingPaise).toBe(10_000_000);
  const unverified = await request(app).get(`/api/workspaces/${id}/forecast`).expect(200);
  expect(unverified.body.warnings).toHaveLength(1);
  const corrected = await request(app).patch(`/api/workspaces/${id}/items/${item.body.item.id}`)
    .send({ expectedDate: '2026-11-12', confidenceState: 'owner_assumption', constraints: {
      earliestCollectionDate: null, maxEarlyCollectionPaise: null } });
  expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
  expect(corrected.body.item.expectedDate).toBe('2026-11-12');
  expect(corrected.body.item.constraints.maxEarlyCollectionPaise).toBeNull();
  await request(app).post(`/api/workspaces/${id}/recurring-rules`).send({ description: 'Rent',
    amountPaise: 2_500_000, dayOfMonth: 5, startsOn: '2026-11-01' }).expect(201);
  const forecast = await request(app).get(`/api/workspaces/${id}/forecast`).expect(200);
  expect(forecast.body.daily.find(day => day.date === '2026-11-05').paymentsPaise).toBe(2_500_000);
  expect(forecast.body.daily.find(day => day.date === '2026-11-12').receiptsPaise).toBe(10_000_000);
});

it('corrects a missing source column and commits an XLSX preview', async () => {
  const created = await request(app).post('/api/workspaces').send({ name: 'Import review test',
    asOfDate: '2026-11-01', openingCashPaise: 0, minimumReservePaise: 0 }).expect(201);
  const id = created.body.workspace.id;
  const csv = Buffer.from('Invoice ID,Customer,Amount INR,Due Date\nINV-NO-DATE,Buyer,100,2026-11-05\n');
  const inspected = await request(app).post(`/api/workspaces/${id}/imports/inspect`)
    .field('kind', 'receivables').attach('file', csv, 'missing.csv').expect(201);
  const batch = inspected.body.batchId;
  const preview = await request(app).post(`/api/workspaces/${id}/imports/${batch}/validate`)
    .send({ mapping: inspected.body.suggestedMapping }).expect(200);
  expect(preview.body.counts.needsReview).toBe(1);
  await request(app).post(`/api/workspaces/${id}/imports/${batch}/commit`).send({}).expect(422);
  const corrected = await request(app).post(`/api/workspaces/${id}/imports/${batch}/commit`)
    .send({ corrections: [{ rowNumber: 2, values: { expectedDate: '2026-11-10' } }] }).expect(200);
  expect(corrected.body.savedCount).toBe(1);

  const workbook = await readFile(new URL('./fixtures/receivables.xlsx', import.meta.url));
  const xlsx = await request(app).post(`/api/workspaces/${id}/imports/inspect`)
    .field('kind', 'receivables').attach('file', workbook, 'valid.xlsx').expect(201);
  const xlsxPreview = await request(app).post(`/api/workspaces/${id}/imports/${xlsx.body.batchId}/validate`)
    .send({ mapping: xlsx.body.suggestedMapping }).expect(200);
  expect(xlsxPreview.body.counts.accepted).toBe(1);
  const xlsxCommit = await request(app).post(`/api/workspaces/${id}/imports/${xlsx.body.batchId}/commit`).send({}).expect(200);
  expect(xlsxCommit.body.savedCount).toBe(1);
  expect(await CashItem.countDocuments({ workspaceId: id })).toBe(2);
});

it('rejects malformed or oversized imports with client errors', async () => {
  const created = await request(app).post('/api/workspaces').send({ name: 'Limits test',
    asOfDate: '2026-11-01', openingCashPaise: 0, minimumReservePaise: 0 }).expect(201);
  const id = created.body.workspace.id;
  const tooManyRows = Buffer.from('Invoice ID,Customer,Amount INR,Due Date,Expected Date\n' +
    Array.from({ length: 501 }, (_, index) => `INV-${index},Buyer,100,2026-11-05,2026-11-10`).join('\n'));
  await request(app).post(`/api/workspaces/${id}/imports/inspect`)
    .field('kind', 'receivables').attach('file', tooManyRows, 'many.csv').expect(400);
  const malformed = await request(app).post(`/api/workspaces/${id}/imports/inspect`)
    .field('kind', 'receivables').attach('file', Buffer.from('not an xlsx'), 'bad.xlsx').expect(400);
  expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
});
