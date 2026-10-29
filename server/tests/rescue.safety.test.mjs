import { describe, expect, test } from 'vitest';
import { analyzeRescue, applyActions, actionFeeEvents, makeCandidates } from '../src/services/rescue/analyze.js';
import { buildForecast } from './rescueForecastStub.mjs';
import { buildForecast as buildSharedForecast } from '../src/services/finance/forecast.js';
import { fixtureContext } from './rescueFixtureSupport.mjs';

const analyze = (context, options = {}) => analyzeRescue(context, options, buildForecast);
describe('rescue safety and fixture evidence', () => {
  test('bundled CSVs produce the expected shortage and traceable conditional rescue', () => {
    const context = fixtureContext();
    const original = structuredClone(context);
    const result = analyze(context);
    expect(result.baseline.firstNegativeDate).toBe('2026-11-06');
    expect(result.baseline.worstCashPaise).toBe(-20_000_000);
    const plan = result.plans.find(plan => plan.actions.length === 2 && plan.actions.some(action => action.cashItemId === 'INV-R100'));
    expect(plan.worstCashPaiseAfter).toBe(14_500_000);
    expect(plan.daily.find(day => day.date === '2026-11-26').receiptsPaise).toBe(20_000_000);
    expect(plan.actions.find(action => action.cashItemId === 'INV-R100')).toMatchObject({ requiresAgreement: true, status: 'proposed', estimatedCostPaise: 300_000, feeDate: '2026-11-04' });
    expect(plan.warnings.join(' ')).toContain('deducted');
    expect(context).toEqual(original);
  });
  test('partial paid invoices accelerate only their outstanding balance', () => {
    const context = fixtureContext();
    context.cashItems[0].settledPaise = 30_000_000;
    context.cashItems[0].status = 'partial';
    const action = makeCandidates(context).find(action => action.cashItemId === 'INV-R100');
    expect(action.amountPaise).toBe(10_000_000);
    const altered = applyActions(context, [action]);
    expect(altered.filter(item => item.id === 'INV-R100')).toHaveLength(1);
    const forecast = buildForecast({ ...context, cashItems: altered });
    expect(forecast.daily.find(day => day.date === '2026-11-04').receiptsPaise).toBe(10_000_000);
    expect(forecast.daily.find(day => day.date === '2026-11-26').receiptsPaise).toBe(0);
  });
  test('partial acceleration retains settlement and source references in both portions', () => {
    const context = fixtureContext();
    context.cashItems[0].settledPaise = 10_000_000;
    context.cashItems[0].status = 'partial';
    const action = makeCandidates(context).find(action => action.cashItemId === 'INV-R100');
    const items = applyActions(context, [action]);
    const portions = items.filter(item => item.externalId === 'INV-R100');
    expect(portions.reduce((sum, item) => sum + item.amountPaise - item.settledPaise, 0)).toBe(30_000_000);
    expect(portions.find(item => item.id !== 'INV-R100').sourceCashItemId).toBe('INV-R100');
  });
  test('duplicate actions, excess collection and unpermitted dates are rejected', () => {
    const context = fixtureContext();
    const action = makeCandidates(context).find(action => action.cashItemId === 'INV-R100');
    expect(() => applyActions(context, [action, action])).toThrow(/one action/);
    expect(() => applyActions(context, [{ ...action, amountPaise: 50_000_000 }])).toThrow(/constraints/);
    expect(() => applyActions(context, [{ ...action, toDate: '2026-11-03' }])).toThrow(/constraints/);
  });
  test('mandatory, nonnegotiable, paid, cancelled and review-needed items are excluded', () => {
    const context = fixtureContext();
    context.cashItems[0].status = 'paid';
    context.cashItems[1].confidenceState = 'needs_review';
    context.cashItems[2].constraints.negotiable = false;
    expect(makeCandidates(context)).toEqual([]);
    context.cashItems[2].constraints.negotiable = true;
    context.cashItems[2].constraints.mandatory = true;
    context.cashItems[0].status = 'cancelled';
    expect(makeCandidates(context)).toEqual([]);
  });
  test('discretionary expense can move only within its bound, with its payment reappearing', () => {
    const context = fixtureContext();
    const bill = context.cashItems[2];
    bill.category = 'expense'; bill.constraints.discretionary = true;
    const action = makeCandidates(context).find(action => action.cashItemId === bill.id);
    expect(action.type).toBe('delay_expense');
    const forecast = buildForecast({ ...context, cashItems: applyActions(context, [action]) });
    expect(forecast.daily.find(day => day.date === '2026-11-06').paymentsPaise).toBe(0);
    expect(forecast.daily.find(day => day.date === '2026-11-26').paymentsPaise).toBe(30_000_000);
    expect(() => applyActions(context, [{ ...action, toDate: '2026-11-27' }])).toThrow(/constraints/);
  });
  test('large extension is capped inside the horizon and cannot hide the payable', () => {
    const context = fixtureContext();
    context.cashItems = [context.cashItems[2]];
    context.cashItems[0].constraints.maxExtensionDays = 200;
    const result = analyze(context);
    expect(result.candidates[0].toDate).toBe('2027-01-29');
    expect(result.plans).toEqual([]);
    const forecast = buildForecast({ ...context, cashItems: applyActions(context, result.candidates), additionalEvents: actionFeeEvents(context, result.candidates) });
    expect(forecast.daily.at(-1).paymentsPaise).toBe(30_200_000);
    expect(forecast.daily.at(-1).closingCashPaise).toBe(-10_200_000);
    expect(result.partialMitigations).toEqual([]);
  });
  test('reserve objective is stricter than nonnegative cash', () => {
    const context = fixtureContext(); context.minimumReservePaise = 10_000_000;
    expect(analyze(context).plans.length).toBeGreaterThan(0);
    expect(analyze(context, { objective: 'minimum_reserve' }).plans.every(plan => plan.daily.every(day => day.closingCashPaise >= 10_000_000))).toBe(true);
  });
  test('recurring obligations and forecast warnings reach rescue analysis', () => {
    const context = fixtureContext();
    context.recurringRules = [{ amountPaise: 100_000_000, dayOfMonth: 5, startsOn: context.asOfDate, active: true }];
    context.cashItems[1].expectedDate = undefined;
    const result = analyze(context);
    expect(result.plans).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('Review required');
  });
  test('existing safe forecast needs no rescue and empty daily forecasts are rejected', () => {
    const context = fixtureContext(); context.cashItems = [];
    expect(analyze(context).message).toContain('no rescue action is needed');
    expect(() => analyzeRescue(context, {}, () => ({ daily: [] }))).toThrow(/incomplete/);
  });
  test('negative opening cash is supported and malformed stored data is rejected', () => {
    const context = fixtureContext(); context.openingCashPaise = -1;
    expect(analyze(context).baseline.worstCashPaise).toBeLessThan(0);
    context.cashItems[0].settledPaise = context.cashItems[0].amountPaise + 1;
    expect(() => analyze(context)).toThrow(/Settlement/);
  });
  test('search cap is explicit and invalid options are rejected', () => {
    const context = fixtureContext();
    const result = analyze(context, { maxCandidates: 1 });
    expect(result.candidateCount).toBe(1);
    expect(result.warnings.join(' ')).toContain('Search limited');
    for (const options of [null, [], { maxCandidates: 13 }, { maxPlans: 4 }, { objective: 'profit' }]) expect(() => analyze(context, options)).toThrow();
  });
});

test('known cost alternatives rank transparently ahead of unknown cost alternatives', () => {
  const context = fixtureContext();
  context.cashItems = [context.cashItems[0], context.cashItems[2]];
  context.cashItems[1].constraints.negotiable = false;
  const second = structuredClone(context.cashItems[0]);
  second.id = 'alternative'; second.externalId = 'INV-ALT'; second.constraints.estimatedActionCostPaise = null;
  context.cashItems.push(second);
  const result = analyze(context);
  expect(result.plans[0].containsUnknownCosts).toBe(false);
  expect(result.plans[0].knownActionCostPaise).toBeGreaterThan(0);
  expect(result.plans.some(plan => plan.containsUnknownCosts && plan.estimatedTotalCostPaise === null)).toBe(true);
});
test('forecast callback mutations cannot alter the original scenario', () => {
  const context = fixtureContext(); const original = structuredClone(context);
  analyzeRescue(context, {}, input => {
    const result = buildForecast(input);
    input.cashItems[0].amountPaise = 0;
    return result;
  });
  expect(context).toEqual(original);
});

test('a rescue receipt cannot be proposed on the opening-cash snapshot day', () => {
  const context = fixtureContext();
  context.cashItems[0].constraints.earliestCollectionDate = context.asOfDate;
  const action = makeCandidates(context).find(candidate => candidate.cashItemId === 'INV-R100');
  expect(action.toDate).toBe('2026-11-02');
  expect(() => applyActions(context, [{ ...action, toDate: context.asOfDate }])).toThrow(/timeline/);
  const forecast = buildSharedForecast({ ...context, cashItems: applyActions(context, [action]) });
  expect(forecast.daily[1].receiptsPaise).toBe(20_000_000);
});

test('snapshot-day bills remain review warnings and do not abort valid rescue analysis', () => {
  const context = fixtureContext();
  context.cashItems.push({
    id: 'snapshot-bill', externalId: 'BILL-SNAPSHOT', category: 'payable',
    status: 'open', amountPaise: 1_000_000, settledPaise: 0,
    expectedDate: context.asOfDate, constraints: { negotiable: true, maxExtensionDays: 10 },
  });
  expect(makeCandidates(context).some(action => action.cashItemId === 'snapshot-bill')).toBe(false);
  const result = analyzeRescue(context, {}, buildSharedForecast);
  expect(result.warnings.join(' ')).toContain('BILL-SNAPSHOT needs a future expected date');
  expect(result.plans.some(plan => plan.worstCashPaiseAfter === 14_500_000)).toBe(true);
});
