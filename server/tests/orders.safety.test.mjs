import { expect, test } from 'vitest';
import { analyzeNewOrder } from '../src/services/orders/analyze.js';
import { buildForecast } from './rescueForecastStub.mjs';
import { buildForecast as buildSharedForecast } from '../src/services/finance/forecast.js';
import { draftOrder, fixtureContext, isolatedContext } from './rescueFixtureSupport.mjs';
import { parseRupees } from '../../client/src/pages/OrderAnalyzer/money.js';
const analyze = (context, order) => analyzeNewOrder(context, order, buildForecast);

test('bundled baseline recomputes a seven-lakh advance instead of hardcoding four lakhs', () => {
  const result = analyze(fixtureContext(), draftOrder());
  expect(result.minimumAdvance.amountPaise).toBe(70_000_000);
  expect(result.minimumAdvance.scenario.daily.every(day => day.closingCashPaise >= 0)).toBe(true);
});
test('every day is safe at threshold and one rupee below fails', () => {
  const context = isolatedContext(); const order = draftOrder();
  expect(analyze(context, { ...order, advancePaise: 39_999_900 }).withOrder.worstCashPaise).toBe(9_999_900);
  expect(analyze(context, { ...order, advancePaise: 40_000_000 }).withOrder.maintainsReserve).toBe(true);
});
test('multiple dated costs and recurring rules change the threshold', () => {
  const context = isolatedContext();
  context.recurringRules = [{ amountPaise: 1_000_000, dayOfMonth: 5, startsOn: '2026-11-01', active: true }];
  const order = draftOrder();
  order.costLines.push({ amountPaise: 5_000_000, paymentDate: '2026-12-10' });
  expect(analyze(context, order).minimumAdvance.amountPaise).toBe(47_000_000);
});
test('full advance can still be insufficient, including after final collection', () => {
  const context = isolatedContext(); const order = draftOrder();
  order.costLines.push({ amountPaise: 100_000_000, paymentDate: '2027-01-20' });
  const result = analyze(context, order);
  expect(result.minimumAdvance.possible).toBe(false);
  expect(result.minimumAdvance.message).toContain('full order advance');
});
test('zero advance is valid when cash covers all costs; same-day advance and final collection are monotone', () => {
  const context = isolatedContext(); context.openingCashPaise = 100_000_000;
  const order = draftOrder(); order.finalCollectionDate = order.advanceDate;
  expect(analyze(context, order).minimumAdvance.amountPaise).toBe(0);
});
test('delayed payment reveals a later shortfall and does not duplicate receipts', () => {
  const context = isolatedContext(); context.minimumReservePaise = 0;
  const order = draftOrder(); order.costLines = [{ amountPaise: 60_000_000, paymentDate: '2027-01-02' }];
  const result = analyze(context, order);
  expect(result.withOrder.firstNegativeDate).toBeNull();
  expect(result.delayedCustomerScenario.firstNegativeDate).toBe('2027-01-02');
  expect(result.delayedCustomerScenario.daily.reduce((sum, day) => sum + day.receiptsPaise, 0)).toBe(80_000_000);
});
test('costs beyond horizon are excluded and warned; inputs and baseline stay unchanged', () => {
  const context = isolatedContext(); const order = draftOrder();
  order.costLines[0].paymentDate = '2027-03-01';
  const before = structuredClone({ context, order });
  const result = analyze(context, order);
  expect(result.minimumAdvance.amountPaise).toBe(0);
  expect(result.warnings.join(' ')).toContain('costs fall outside');
  expect({ context, order }).toEqual(before);
});
test('invalid and unsafe monetary input cannot become a scenario', () => {
  const context = isolatedContext();
  for (const value of [-1, 0.2, '8000', null, Number.MAX_SAFE_INTEGER + 1]) expect(() => analyze(context, { ...draftOrder(), orderValuePaise: value })).toThrow();
  expect(() => analyze(context, { ...draftOrder(), costLines: [null] })).toThrow();
  expect(() => analyze(context, { ...draftOrder(), advancePaise: 90_000_000 })).toThrow();
  expect(() => analyze(context, { ...draftOrder(), orderValuePaise: Number.MAX_SAFE_INTEGER })).toThrow(/safe integer/);
});
test('past, reversed and invalid dates are rejected; no UI float rounding', () => {
  const context = isolatedContext();
  expect(() => analyze(context, { ...draftOrder(), advanceDate: '2026-10-31' })).toThrow(/snapshot/);
  expect(() => analyze(context, { ...draftOrder(), finalCollectionDate: '2026-11-01' })).toThrow(/precede/);
  expect(() => analyze(context, { ...draftOrder(), finalCollectionDate: '2027-02-29' })).toThrow(/valid YYYY-MM-DD/);
  expect(parseRupees('₹1,20,000')).toBe(12_000_000);
  expect(parseRupees('0.29')).toBe(29);
  expect(() => parseRupees('1,2,000')).toThrow();
  expect(() => parseRupees('1.001')).toThrow();
});
test('forecast dependency receives unchanged baseline items and only hypothetical order events', () => {
  const context = fixtureContext(); const original = structuredClone(context.cashItems);
  const calls = [];
  analyzeNewOrder(context, draftOrder(), input => { calls.push(structuredClone(input)); return buildForecast(input); });
  expect(calls.length).toBeGreaterThan(2);
  expect(calls.every(call => JSON.stringify(call.cashItems) === JSON.stringify(calls[0].cashItems))).toBe(true);
  expect(calls[0].additionalEvents).toEqual([]);
  expect(calls.slice(1).every(call => call.additionalEvents.every(event => event.sourceId === 'proposed-order'))).toBe(true);
  expect(context.cashItems).toEqual(original);
});

test('snapshot-day order cash is rejected instead of silently omitted by the shared forecast', () => {
  const context = isolatedContext();
  expect(() => analyzeNewOrder(context, { ...draftOrder(), advanceDate: context.asOfDate }, buildSharedForecast)).toThrow(/snapshot/);
  expect(() => analyzeNewOrder(context, { ...draftOrder(), costLines: [{ amountPaise: 50_000_000, paymentDate: context.asOfDate }] }, buildSharedForecast)).toThrow(/snapshot/);
  expect(analyzeNewOrder(context, draftOrder(), buildSharedForecast).minimumAdvance.amountPaise).toBe(40_000_000);
});
