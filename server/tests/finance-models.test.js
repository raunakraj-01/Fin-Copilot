import mongoose from 'mongoose';
import { expect, it } from 'vitest';
import RescuePlan from '../src/models/RescuePlan.js';
import OrderScenario from '../src/models/OrderScenario.js';

const workspaceId = new mongoose.Types.ObjectId();

it('validates persisted rescue and order scenarios without posting cash items', () => {
  const plan = new RescuePlan({ workspaceId, asOfDate: '2026-11-01', objective: 'nonnegative',
    baselineWorstCashPaise: -20_000_000, simulatedWorstCashPaise: 0,
    containsUnknownCosts: true, feasibility: 'conditional', actions: [{ actionId: 'a1',
      cashItemId: new mongoose.Types.ObjectId(), type: 'accelerate_collection', amountPaise: 20_000_000,
      fromDate: '2026-11-26', toDate: '2026-11-04' }] });
  expect(plan.validateSync()).toBeUndefined();
  plan.estimatedTotalCostPaise = 100;
  expect(plan.validateSync().errors.estimatedTotalCostPaise).toBeDefined();
  const order = new OrderScenario({ workspaceId, label: 'Example', orderValuePaise: 80_000_000,
    advancePaise: 90_000_000, advanceDate: '2026-11-02', finalCollectionDate: '2026-12-31',
    costLines: [{ description: 'Material', amountPaise: 50_000_000, paymentDate: '2026-11-11' }] });
  expect(order.validateSync().errors.advancePaise).toBeDefined();
  order.advancePaise = 40_000_000;
  expect(order.validateSync()).toBeUndefined();
});
