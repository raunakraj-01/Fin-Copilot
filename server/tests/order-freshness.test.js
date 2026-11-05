import { expect, it } from 'vitest';
import { analysisFingerprint, scenarioFreshness } from '../src/services/orders/freshness.js';
import { prepareSavedScenario } from '../src/services/orders/saveScenario.js';
import { buildForecast } from '../src/services/finance/forecast.js';
const context = () => ({ asOfDate: '2026-11-01', openingCashPaise: 10000, minimumReservePaise: 5000, horizonDays: 30,
  cashItems: [{ id: 'invoice', category: 'receivable', status: 'open', amountPaise: 20000, settledPaise: 0, expectedDate: '2026-11-05' }],
  recurringRules: [{ id: 'rent', amountPaise: 1000, dayOfMonth: 15, startsOn: '2026-11-01', active: true }] });
const order = () => ({ label: '  Order A  ', orderValuePaise: 40000, advancePaise: 0, advanceDate: '2026-11-02', finalCollectionDate: '2026-11-20',
  delayedCollectionDays: 14, costLines: [{ description: '  Materials  ', amountPaise: 30000, paymentDate: '2026-11-03' }] });

it('stores normalized terms and the delay setting with a reproducible context fingerprint', () => {
  const input = context(); const saved = prepareSavedScenario(input, order(), buildForecast);
  expect(saved.delayedCollectionDays).toBe(14);
  expect(saved.label).toBe('Order A');
  expect(saved.costLines[0].description).toBe('Materials');
  expect(saved.analysisContext.fingerprint).toBe(analysisFingerprint(input, saved));
  expect(scenarioFreshness(input, saved).stale).toBe(false);
});

it('detects amount/date/settlement, promise, actual-receipt, recurring and workspace cash changes', () => {
  const input = context(); const saved = prepareSavedScenario(input, order(), buildForecast);
  const mutations = [c => { c.cashItems[0].amountPaise++; }, c => { c.cashItems[0].expectedDate = '2026-11-06'; },
    c => { c.cashItems[0].settledPaise = 1; c.cashItems[0].status = 'partial'; },
    c => { c.cashItems[0].paymentPromises = [{ id: 'p', amountPaise: 1000, promisedDate: '2026-11-04', receivedPaise: 0 }]; },
    c => { c.cashItems[0].gatewayReceipts = [{ paymentOfferId: 'receipt', date: '2026-11-03', amountPaise: 1 }]; },
    c => { c.recurringRules[0].amountPaise++; }, c => { c.recurringRules[0].active = false; }, c => { c.openingCashPaise++; },
    c => { c.minimumReservePaise++; }, c => { c.horizonDays++; }, c => { c.asOfDate = '2026-11-02'; },
    c => { c.cashItems = []; }, c => { c.cashItems[0].confidenceState = 'needs_review'; }];
  for (const mutate of mutations) { const changed = structuredClone(input); mutate(changed); expect(scenarioFreshness(changed, saved).stale).toBe(true); }
});

it('ignores timestamps, notes, history and storage row order', () => {
  const input = context(); input.cashItems.push({ ...input.cashItems[0], id: 'other' });
  const saved = prepareSavedScenario(input, order(), buildForecast);
  const reordered = structuredClone(input); reordered.cashItems.reverse();
  reordered.cashItems[0].updatedAt = new Date(); reordered.cashItems[0].notes = 'New note';
  expect(scenarioFreshness(reordered, saved).stale).toBe(false);
});

it('marks legacy analyses and expired order dates for review without inventing replacements', () => {
  expect(scenarioFreshness(context(), order())).toMatchObject({ stale: true, reason: 'legacy_analysis' });
  const saved = prepareSavedScenario(context(), order(), buildForecast);
  expect(scenarioFreshness({ ...context(), asOfDate: '2026-11-03' }, saved)).toMatchObject({ stale: true, datesExpired: true, reason: 'order_dates_expired' });
  expect(saved.advanceDate).toBe('2026-11-02');
});
