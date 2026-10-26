// Run after Person 1's forecast module is installed. Deliberately has no stub fallback.
import assert from 'node:assert/strict';
import { buildForecast } from '../src/services/finance/forecast.js';
import { analyzeRescue } from '../src/services/rescue/analyze.js';
import { analyzeNewOrder } from '../src/services/orders/analyze.js';
import { draftOrder, fixtureContext, isolatedContext } from './rescueFixtureSupport.mjs';
const rescue = analyzeRescue(fixtureContext(), {}, buildForecast);
assert.equal(rescue.baseline.firstNegativeDate, '2026-11-06');
assert.equal(rescue.baseline.worstCashPaise, -20_000_000);
assert.ok(rescue.plans.some(plan => plan.actions.length === 1 && plan.actions[0].cashItemId === 'INV-R100' && plan.worstCashPaiseAfter === 0));
assert.equal(analyzeNewOrder(isolatedContext(), draftOrder(), buildForecast).minimumAdvance.amountPaise, 40_000_000);
assert.equal(analyzeNewOrder(fixtureContext(), draftOrder(), buildForecast).minimumAdvance.amountPaise, 70_000_000);
console.log('Shared forecast integration checks passed. Both engines used the same finance/forecast.js module.');
