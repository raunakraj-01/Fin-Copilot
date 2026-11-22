import { beforeAll, afterAll, expect, test } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import app from '../src/app.js';
import CashItem from '../src/models/CashItem.js';
import { analyzeShock } from '../src/services/finance/shock.js';
import { analyzeRescue } from '../src/services/rescue/analyze.js';
import { analyzeNewOrder } from '../src/services/orders/analyze.js';
import { buildForecast } from '../src/services/finance/forecast.js';

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test('executes the full demo walkthrough end-to-end with mathematical exactness', async () => {
  const wsRes = await request(app)
    .post('/api/workspaces')
    .send({
      name: 'Demo Packaging Supplier',
      asOfDate: '2026-11-01',
      openingCashPaise: 20_000_000,
      minimumReservePaise: 0,
    })
    .expect(201);

  const workspaceId = wsRes.body.workspace.id;
  expect(workspaceId).toBeTruthy();

  await request(app)
    .post(`/api/workspaces/${workspaceId}/items`)
    .send({
      category: 'payable',
      externalId: 'BILL-P100',
      counterparty: 'Alpha Paper Mills',
      amountPaise: 30_000_000,
      dueDate: '2026-11-06',
      expectedDate: '2026-11-06',
      constraints: { mandatory: true },
    })
    .expect(201);

  await request(app)
    .post(`/api/workspaces/${workspaceId}/items`)
    .send({
      category: 'payable',
      externalId: 'BILL-P200',
      counterparty: 'Staff Salaries',
      amountPaise: 10_000_000,
      dueDate: '2026-11-11',
      expectedDate: '2026-11-11',
      constraints: { mandatory: true },
    })
    .expect(201);

  await request(app)
    .post(`/api/workspaces/${workspaceId}/items`)
    .send({
      category: 'receivable',
      externalId: 'INV-R100',
      counterparty: 'Acme Retail',
      amountPaise: 40_000_000,
      dueDate: '2026-11-15',
      expectedDate: '2026-11-26',
      confidenceState: 'owner_assumption',
      constraints: {
        earliestCollectionDate: '2026-11-04',
        maxEarlyCollectionPaise: 20_000_000,
        estimatedActionCostPaise: 300_000,
        actionCostDate: '2026-11-04',
      },
    })
    .expect(201);

  const forecastRes = await request(app)
    .get(`/api/workspaces/${workspaceId}/forecast`)
    .expect(200);

  const forecast = forecastRes.body;
  expect(forecast.risk.firstNegativeDate).toBe('2026-11-06');
  expect(forecast.risk.worstCashPaise).toBe(-20_000_000);
  expect(forecast.risk.worstDate).toBe('2026-11-11');

  const items = await CashItem.find({ workspaceId }).lean();
  const shockContext = {
    asOfDate: '2026-11-01',
    horizonDays: 90,
    openingCashPaise: 20_000_000,
    minimumReservePaise: 0,
    cashItems: items.map(i => ({ ...i, id: String(i._id) })),
    recurringRules: [],
  };

  const shock = analyzeShock(shockContext, { counterparty: 'Acme Retail', delayDays: 7 }, buildForecast);
  expect(shock.baseline.peakGapPaise).toBe(20_000_000);
  expect(shock.uncertainties).toBeDefined();
  expect(shock.uncertainties.length).toBeGreaterThan(0);
  expect(shock.uncertainties[0].counterparty).toBe('Acme Retail');

  const rescue = analyzeRescue(shockContext, { objective: 'nonnegative', maxPlans: 3 }, buildForecast);
  expect(rescue.evaluatedCombinationCount).toBeGreaterThan(0);

  const orderRes = await request(app)
    .post(`/api/workspaces/${workspaceId}/orders/analyze`)
    .send({
      orderValuePaise: 80_000_000,
      advancePaise: 0,
      advanceDate: '2026-11-02',
      finalCollectionDate: '2026-12-31',
      costLines: [
        { description: 'Raw materials', amountPaise: 50_000_000, paymentDate: '2026-11-11' },
      ],
    })
    .expect(200);

  expect(orderRes.body.minimumAdvance.possible).toBe(true);
  expect(orderRes.body.negotiationEnvelope).toBeDefined();
  expect(orderRes.body.negotiationEnvelope.length).toBeGreaterThan(0);
});

