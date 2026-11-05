import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import app from '../src/app.js';
import CashItem from '../src/models/CashItem.js';
import RescuePlan from '../src/models/RescuePlan.js';
let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); }, 600000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
async function setup(type = 'defer_payable') {
  const workspace = (await request(app).post('/api/workspaces').send({ name: 'Outcomes pilot', asOfDate: '2026-11-01', openingCashPaise: 20000 }).expect(201)).body.workspace;
  const base = `/api/workspaces/${workspace.id}`;
  const invoice = (await request(app).post(`${base}/items`).send({ category: 'receivable', counterparty: 'Buyer', externalId: 'INV-OUTCOME', amountPaise: 100000,
    dueDate: '2026-11-10', expectedDate: '2026-11-10', constraints: { earliestCollectionDate: '2026-11-02', maxEarlyCollectionPaise: 60000, estimatedActionCostPaise: 0 } }).expect(201)).body.item;
  const bill = (await request(app).post(`${base}/items`).send({ category: 'payable', counterparty: 'Supplier', externalId: 'BILL-OUTCOME', amountPaise: 60000,
    dueDate: '2026-11-05', expectedDate: '2026-11-05', constraints: { negotiable: true, maxExtensionDays: 10, estimatedActionCostPaise: 0 } }).expect(201)).body.item;
  const action = type === 'defer_payable' ? { cashItemId: bill.id, type, amountPaise: 60000, fromDate: '2026-11-05', toDate: '2026-11-15' }
    : { cashItemId: invoice.id, type, amountPaise: 60000, fromDate: '2026-11-10', toDate: '2026-11-03' };
  const plan = (await request(app).post(`${base}/rescue/plans`).send({ objective: 'nonnegative', actions: [action] }).expect(201)).body;
  return { base, invoice, bill, plan, path: `${base}/rescue/plans/${plan._id}/actions/${plan.actions[0].actionId}` };
}
it('recalculates agreed and rejected extensions immediately and preserves original saved figures and cash records', async () => {
  const { base, plan, path } = await setup();
  const before = await CashItem.find({ workspaceId: plan.workspaceId }).lean();
  let listed = (await request(app).get(`${base}/rescue/plans`).expect(200)).body.plans[0];
  expect(listed.live.current.minimumCashPaise).toBe(-40000);
  const agreed = (await request(app).patch(path).send({ status: 'agreed', ownerNotes: 'Supplier confirmed' }).expect(200)).body;
  expect(agreed.live.current.minimumCashPaise).toBe(20000);
  const rejected = (await request(app).patch(path).send({ status: 'rejected', ownerNotes: 'Supplier withdrew extension' }).expect(200)).body;
  expect(rejected.live.current.minimumCashPaise).toBe(-40000);
  expect(rejected.live.signals.some(s => s.type === 'rejected_extension')).toBe(true);
  expect(rejected.actions[0].history.map(h => h.toStatus)).toEqual(['agreed', 'rejected']);
  listed = (await request(app).get(`${base}/rescue/plans`)).body.plans[0];
  expect(listed.simulatedWorstCashPaise).toBe(plan.simulatedWorstCashPaise);
  expect(listed.live.current.minimumCashPaise).toBe(-40000);
  expect(await CashItem.find({ workspaceId: plan.workspaceId }).lean()).toEqual(before);
});

it('links promises and recalculates broken/partial-payment outcomes on each read without double settlement', async () => {
  const { base, invoice, plan, path } = await setup('accelerate_collection');
  const promise = (await request(app).post(`${base}/items/${invoice.id}/promises`).send({ amountPaise: 60000, promisedDate: '2026-11-03' }).expect(201)).body.promises[0];
  const agreed = (await request(app).patch(path).send({ status: 'agreed', promiseId: promise.id }).expect(200)).body;
  expect(agreed.live.actions[0].status).toBe('tracking_promise');
  expect(agreed.live.current.minimumCashPaise).toBe(20000);
  await request(app).patch(base).send({ asOfDate: '2026-11-04' }).expect(200);
  let live = (await request(app).get(`${base}/rescue/plans`)).body.plans[0].live;
  expect(live.actions[0].status).toBe('broken_promise');
  expect(live.current.minimumCashPaise).toBe(-40000);
  const receipt = { amountPaise: 20000, receivedDate: '2026-11-05', requestId: randomUUID() };
  await request(app).post(`${base}/items/${invoice.id}/promises/${promise.id}/receipts`).send(receipt).expect(200);
  await request(app).post(`${base}/items/${invoice.id}/promises/${promise.id}/receipts`).send(receipt).expect(200);
  live = (await request(app).get(`${base}/rescue/plans`)).body.plans[0].live;
  expect(live.actions[0]).toMatchObject({ remainingActionPaise: 40000, observedSettlementPaise: 20000 });
  expect(live.current.minimumCashPaise).toBe(-20000);
  expect(live.affectedPayments).toContainEqual(expect.objectContaining({ label: 'BILL-OUTCOME', gapPaise: 20000 }));
  expect((await CashItem.findById(invoice.id)).settledPaise).toBe(20000);
  expect((await RescuePlan.findById(plan._id)).simulatedWorstCashPaise).toBe(plan.simulatedWorstCashPaise);
});

it('requires review after promise revisions until a replacement is explicitly linked', async () => {
  const { base, invoice, path } = await setup('accelerate_collection');
  const promisesPath = `${base}/items/${invoice.id}/promises`;
  const original = (await request(app).post(promisesPath).send({ amountPaise: 60000, promisedDate: '2026-11-03' }).expect(201)).body.promises[0];
  await request(app).patch(path).send({ status: 'agreed', promiseId: original.id }).expect(200);
  const revised = (await request(app).patch(`${promisesPath}/${original.id}`).send({ amountPaise: 60000, promisedDate: '2026-11-06' }).expect(200)).body.promises.at(-1);
  expect((await request(app).get(`${base}/rescue/plans`)).body.plans[0].live.status).toBe('needs_review');
  const relinked = (await request(app).patch(path).send({ promiseId: revised.id }).expect(200)).body;
  expect(relinked.live.status).toBe('insufficient');
  expect(relinked.live.actions[0].status).toBe('tracking_promise');
  expect(relinked.live.current.firstNegativeDate).toBe('2026-11-05');
});

it('rejects cross-workspace promises, non-collection links and financial field tampering', async () => {
  const local = await setup('accelerate_collection');
  const other = await setup('accelerate_collection');
  const p = (await request(app).post(`${other.base}/items/${other.invoice.id}/promises`).send({ amountPaise: 60000, promisedDate: '2026-11-03' })).body.promises[0];
  await request(app).patch(local.path).send({ promiseId: p.id }).expect(400);
  const extension = await setup();
  await request(app).patch(extension.path).send({ promiseId: p.id }).expect(400);
  await request(app).patch(local.path).send({ status: 'agreed', simulatedWorstCashPaise: 1000000 }).expect(400);
  await request(app).patch(`${other.base}/rescue/plans/${local.plan._id}/actions/action-1`).send({ status: 'rejected' }).expect(404);
});
