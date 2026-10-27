import { test } from 'vitest';
import assert from 'node:assert/strict';
import { analyzeRescue } from '../src/services/rescue/analyze.js';
import { buildForecast } from './rescueForecastStub.mjs';

const lakh = 10_000_000;
function context() {
  return {
    asOfDate: '2026-11-01', horizonDays: 90, openingCashPaise: 2 * lakh, minimumReservePaise: 0,
    cashItems: [
      { id: 'bill', externalId: 'BILL-P200', category: 'payable', amountPaise: 3 * lakh, settledPaise: 0, expectedDate: '2026-11-06', status: 'open', negotiable: true, maxExtensionDays: 9, estimatedActionCostPaise: 200_000 },
      { id: 'payroll', category: 'expense', amountPaise: lakh, settledPaise: 0, expectedDate: '2026-11-11', status: 'open', mandatory: true, discretionary: false },
      { id: 'invoice', externalId: 'INV-R100', category: 'receivable', amountPaise: 4 * lakh, settledPaise: 0, expectedDate: '2026-11-26', status: 'open', earliestCollectionDate: '2026-11-04', maxEarlyCollectionPaise: 2 * lakh, estimatedActionCostPaise: 300_000 },
    ],
  };
}

test('early partial receipt is moved, never duplicated, and source item stays intact', () => {
  const input = context();
  const original = structuredClone(input);
  const result = analyzeRescue(input, {}, buildForecast);
  const plan = result.plans.find(value => value.actions.length === 1 && value.actions[0].type === 'accelerate_collection');
  assert.ok(plan);
  assert.equal(plan.daily.find(day => day.date === '2026-11-04').receiptsPaise, 2 * lakh);
  assert.equal(plan.daily.find(day => day.date === '2026-11-26').receiptsPaise, 2 * lakh);
  assert.equal(plan.daily.find(day => day.date === '2026-11-11').closingCashPaise, 0);
  assert.deepEqual(input, original);
});

test('mandatory outflows are excluded and a short deferral is not called a full rescue', () => {
  const input = context();
  input.cashItems[2].maxEarlyCollectionPaise = 0;
  const result = analyzeRescue(input, {}, buildForecast);
  assert.equal(result.plans.length, 0);
  assert.ok(result.partialMitigations.length > 0);
  assert.ok(result.partialMitigations.every(plan => plan.actions.every(action => action.cashItemId !== 'payroll')));
  assert.equal(result.partialMitigations[0].daily.find(day => day.date === '2026-11-15').closingCashPaise, -2 * lakh);
});

test('unknown costs stay unknown and no action means no feasible plan', () => {
  const input = context();
  input.cashItems[2].estimatedActionCostPaise = null;
  const result = analyzeRescue(input, {}, buildForecast);
  assert.ok(result.plans.some(plan => plan.containsUnknownCosts));
  assert.ok(result.plans.some(plan => plan.warnings.some(warning => warning.includes('unknown'))));
  input.cashItems[0].negotiable = false;
  input.cashItems[2].maxEarlyCollectionPaise = 0;
  const none = analyzeRescue(input, {}, buildForecast);
  assert.equal(none.candidateCount, 0);
  assert.deepEqual(none.plans, []);
  assert.match(none.message, /No feasible plan/);
});
