import { test } from 'vitest';
import assert from 'node:assert/strict';
import { analyzeNewOrder } from '../src/services/orders/analyze.js';
import { buildForecast } from './rescueForecastStub.mjs';

const lakh = 10_000_000;
const context = { asOfDate: '2026-11-01', horizonDays: 90, openingCashPaise: 2 * lakh, minimumReservePaise: lakh, cashItems: [] };
const order = {
  label: 'New order', orderValuePaise: 8 * lakh, advancePaise: 0,
  advanceDate: '2026-11-02', finalCollectionDate: '2026-12-31',
  costLines: [{ description: 'Materials', amountPaise: 5 * lakh, paymentDate: '2026-11-11' }],
  delayedCollectionDays: 14,
};

test('minimum advance is exact to one paise and total receipt stays equal to order value', () => {
  const result = analyzeNewOrder(context, order, buildForecast);
  assert.equal(result.minimumAdvance.amountPaise, 4 * lakh);
  const onePaiseShort = analyzeNewOrder(context, { ...order, advancePaise: 4 * lakh - 1 }, buildForecast);
  assert.equal(onePaiseShort.withOrder.daily.find(day => day.date === '2026-11-11').closingCashPaise, lakh - 1);
  const enough = analyzeNewOrder(context, { ...order, advancePaise: 4 * lakh }, buildForecast);
  assert.equal(enough.withOrder.daily.find(day => day.date === '2026-11-11').closingCashPaise, lakh);
  assert.equal(enough.withOrder.daily.reduce((sum, day) => sum + day.receiptsPaise, 0), 8 * lakh);
});

test('an advance arriving after costs cannot cure the earlier breach', () => {
  const result = analyzeNewOrder(context, { ...order, advanceDate: '2026-11-12' }, buildForecast);
  assert.equal(result.minimumAdvance.possible, false);
  assert.match(result.minimumAdvance.message, /before the advance arrives/);
});

test('existing shortage is distinguished and out-of-horizon collection is warned', () => {
  const existing = { ...context, cashItems: [{ id: 'bill', category: 'payable', amountPaise: 3 * lakh, expectedDate: '2026-11-01', status: 'open' }] };
  const result = analyzeNewOrder(existing, { ...order, finalCollectionDate: '2027-03-01' }, buildForecast);
  assert.equal(result.baseline.firstReserveBreachDate, '2026-11-01');
  assert.equal(result.withOrder.firstNewBreachDate, null);
  assert.ok(result.warnings.some(warning => warning.includes('existing cash plan')));
  assert.ok(result.warnings.some(warning => warning.includes('outside the forecast horizon')));
});

test('invalid calendar dates are rejected', () => {
  assert.throws(() => analyzeNewOrder(context, { ...order, advanceDate: '2026-02-30' }, buildForecast), /valid YYYY-MM-DD date/);
});
