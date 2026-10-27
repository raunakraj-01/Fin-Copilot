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
import rescueRouter from '../src/routes/rescue.js';

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
  console.log('MongoDB rescue checks passed: persistence, recalculation, unknown costs, workspace isolation, stale-action rejection, and unchanged cash items.');
} finally {
  await mongoose.disconnect();
  await database.stop();
}
