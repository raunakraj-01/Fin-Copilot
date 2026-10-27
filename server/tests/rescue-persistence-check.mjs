// Run from the repository root after installing server dependencies:
// node server/tests/rescue-persistence-check.mjs
// Uses a disposable database; never reads MONGODB_URI or the application's database.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import RescuePlan from '../src/models/RescuePlan.js';
import OrderScenario from '../src/models/OrderScenario.js';
import rescueRouter from '../src/routes/rescue.js';
import ordersRouter from '../src/routes/orders.js';
import { draftOrder } from './rescueFixtureSupport.mjs';

const database = await MongoMemoryServer.create();
try {
  await mongoose.connect(database.getUri());
  const workspace = await Workspace.create({ name: 'Rescue persistence check', asOfDate: '2026-11-01', openingCashPaise: 20_000_000 });
  const otherWorkspace = await Workspace.create({ name: 'Other workspace', asOfDate: '2026-11-01', openingCashPaise: 20_000_000 });
  const rows = [
    { category: 'payable', externalId: 'BILL', amountPaise: 30_000_000, expectedDate: '2026-11-06', constraints: { negotiable: false } },
    { category: 'expense', externalId: 'PAYROLL', amountPaise: 10_000_000, expectedDate: '2026-11-11', constraints: { mandatory: true } },
    { category: 'receivable', externalId: 'INV', amountPaise: 40_000_000, expectedDate: '2026-11-26', constraints: { earliestCollectionDate: '2026-11-04', maxEarlyCollectionPaise: 20_000_000, estimatedActionCostPaise: 300_000 } },
  ];
  const items = await CashItem.create(rows.map(row => ({ ...row, workspaceId: workspace._id, counterparty: 'Demo', sourceSystem: 'manual', dueDate: row.expectedDate })));
  const invoice = items[2];
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces/:workspaceId/rescue', rescueRouter);
  app.use('/api/workspaces/:workspaceId/orders', ordersRouter);
  const action = { cashItemId: String(invoice._id), type: 'accelerate_collection', amountPaise: 20_000_000, fromDate: '2026-11-26', toDate: '2026-11-04' };
  const save = (workspaceId, actions = [action]) => request(app).post(`/api/workspaces/${workspaceId}/rescue/plans`).send({ objective: 'nonnegative', actions });
  const sourceSnapshot = async () => JSON.stringify(await CashItem.find().sort({ _id: 1 }).lean());

  const before = await sourceSnapshot();
  // Ignore browser-supplied costs and completion status; derive the persisted proposal.
  const response = await save(workspace._id, [{ ...action, estimatedCostPaise: 0, status: 'completed' }]);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const saved = await RescuePlan.findById(response.body._id).lean();
  assert.equal(String(saved.workspaceId), String(workspace._id));
  assert.equal(saved.status, 'proposed');
  assert.equal(saved.feasibility, 'conditional');
  assert.equal(saved.baselineWorstCashPaise, -20_000_000);
  assert.equal(saved.simulatedWorstCashPaise, 0);
  assert.equal(saved.estimatedTotalCostPaise, 300_000);
  assert.equal(saved.actions[0].status, 'proposed');
  assert.equal(String(saved.actions[0].cashItemId), String(invoice._id));
  assert.equal(await sourceSnapshot(), before);

  const actionUrl = `/api/workspaces/${workspace._id}/rescue/plans/${saved._id}/actions/action-1`;
  for (const status of ['requested', 'agreed', 'completed']) {
    const updated = await request(app).patch(actionUrl).send({ status, ownerNotes: `Owner marked ${status}` });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.actions[0].status, status);
  }
  const noteUpdate = await request(app).patch(actionUrl).send({ ownerNotes: 'Reconciled separately' });
  assert.equal(noteUpdate.body.actions[0].status, 'completed');
  assert.equal((await RescuePlan.findById(saved._id).lean()).actions[0].ownerNotes, 'Reconciled separately');
  assert.equal((await request(app).patch(actionUrl).send({ settledPaise: 1 })).status, 400);
  assert.equal((await request(app).patch(`/api/workspaces/${otherWorkspace._id}/rescue/plans/${saved._id}/actions/action-1`).send({ status: 'rejected' })).status, 404);
  assert.equal((await request(app).patch(actionUrl.replace('action-1', 'action-99')).send({ status: 'rejected' })).status, 404);
  const ownPlans = await request(app).get(`/api/workspaces/${workspace._id}/rescue/plans`);
  assert.equal(ownPlans.body.plans[0].actions[0].status, 'completed');
  assert.deepEqual((await request(app).get(`/api/workspaces/${otherWorkspace._id}/rescue/plans`)).body.plans, []);
  assert.equal(await sourceSnapshot(), before);

  // The same action cannot reference an invoice outside the requested workspace.
  assert.equal((await save(otherWorkspace._id)).status, 400);
  assert.equal((await save(new mongoose.Types.ObjectId())).status, 404);
  assert.equal((await save(workspace._id, [action, action])).status, 400);
  assert.equal(await RescuePlan.countDocuments(), 1);
  assert.equal(await sourceSnapshot(), before);

  // A later read uses current stored costs, including an explicitly unknown cost.
  await CashItem.updateOne({ _id: invoice._id }, { $set: { 'constraints.estimatedActionCostPaise': null } });
  const beforeUnknownCostSave = await sourceSnapshot();
  const unknownCost = await save(workspace._id);
  assert.equal(unknownCost.status, 201);
  const unknownCostSaved = await RescuePlan.findById(unknownCost.body._id).lean();
  assert.equal(unknownCostSaved.containsUnknownCosts, true);
  assert.equal(unknownCostSaved.estimatedTotalCostPaise, null);
  assert.equal(await sourceSnapshot(), beforeUnknownCostSave);

  // Previously displayed actions are rejected if settlement reduced available cash.
  await CashItem.updateOne({ _id: invoice._id }, { $set: { settledPaise: 30_000_000, status: 'partial' } });
  const beforeStaleSave = await sourceSnapshot();
  const stale = await save(workspace._id);
  assert.equal(stale.status, 400);
  assert.equal(stale.body.error.code, 'VALIDATION_ERROR');
  assert.equal(await RescuePlan.countDocuments(), 2);
  assert.equal(await sourceSnapshot(), beforeStaleSave);
  const orderWorkspace = await Workspace.create({ name: 'Hypothetical order checks', asOfDate: '2026-11-01', openingCashPaise: 20_000_000, minimumReservePaise: 10_000_000 });
  const orderSave = await request(app).post(`/api/workspaces/${orderWorkspace._id}/orders/scenarios`).send({ ...draftOrder(), simulatedMinimumAdvancePaise: 0 });
  assert.equal(orderSave.status, 201, JSON.stringify(orderSave.body));
  const scenario = await OrderScenario.findById(orderSave.body._id).lean();
  assert.equal(scenario.simulatedMinimumAdvancePaise, 40_000_000);
  assert.ok(scenario.scenarioWarnings.some(text => text.includes('Hypothetical')));
  const orderList = await request(app).get(`/api/workspaces/${orderWorkspace._id}/orders/scenarios`);
  assert.equal(orderList.body.scenarios.length, 1);
  assert.equal(orderList.body.scenarios[0]._id, orderSave.body._id);
  assert.deepEqual((await request(app).get(`/api/workspaces/${otherWorkspace._id}/orders/scenarios`)).body.scenarios, []);
  const impossible = await request(app).post(`/api/workspaces/${orderWorkspace._id}/orders/scenarios`).send({ ...draftOrder(), advanceDate: '2026-11-12' });
  assert.equal(impossible.status, 201);
  assert.equal((await OrderScenario.findById(impossible.body._id).lean()).simulatedMinimumAdvancePaise, null);
  assert.equal(await sourceSnapshot(), beforeStaleSave);
  const workspaceAfter = await Workspace.findById(orderWorkspace._id).lean();
  assert.equal(workspaceAfter.openingCashPaise, 20_000_000);
  assert.equal(workspaceAfter.minimumReservePaise, 10_000_000);
  console.log('MongoDB checks passed: rescue and order persistence, scoped retrieval, action tracking, recalculation, unknown costs, stale-action rejection, and unchanged cash records.');
} finally {
  await mongoose.disconnect();
  await database.stop();
}
