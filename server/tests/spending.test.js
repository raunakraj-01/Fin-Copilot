import { expect, it } from 'vitest';
import { spendingCheck } from '../src/services/finance/spending.js';

const item = (id, category, amountPaise, expectedDate, extra = {}) => ({ id, category, amountPaise, expectedDate,
  settledPaise: 0, status: 'open', confidenceState: 'owner_assumption', ...extra });
const context = (changes = {}) => ({ asOfDate: '2026-11-05', horizonDays: 30, openingCashPaise: 100000,
  minimumReservePaise: 20000, cashItems: [item('receipt', 'receivable', 80000, '2026-11-07'), item('wages', 'payable', 60000, '2026-11-09')], ...changes });
const options = { today: '2026-11-05', commitmentsConfirmed: true };

it('uses the lowest daily balance including today rather than closing cash at the end', () => {
  const result = spendingCheck(context(), options);
  expect(result.expected.spendablePaise).toBe(80000); // today's 100000 - reserve
  expect(result.delayed.spendablePaise).toBe(20000); // wages paid before late receipt
  expect(result.recommendedSpendablePaise).toBe(20000);
  expect(result.endDate).toBe('2026-12-04');
  expect(result.status).toBe('conditional');
});

it('checks the exact threshold, a one-paisa excess and a pre-existing reserve breach', () => {
  expect(spendingCheck(context(), { ...options, spendPaise: 20000 }).delayed.canSpend).toBe(true);
  const over = spendingCheck(context(), { ...options, spendPaise: 20001 });
  expect(over.expected.canSpend).toBe(true);
  expect(over.delayed.canSpend).toBe(false);
  expect(over.delayed.firstBreachAfterSpend).toBe('2026-11-09');
  const breach = spendingCheck(context({ openingCashPaise: 10000 }), options);
  expect(breach.expected.spendablePaise).toBe(0);
  expect(breach.expected.canSpend).toBe(false);
  expect(breach.expected.reserveGapPaise).toBe(10000);
  expect(breach.expected.firstReserveBreachDate).toBe('2026-11-05');
});

it('withholds limits for stale/future snapshots or unconfirmed obligations', () => {
  for (const [today, code] of [['2026-11-06', 'STALE_CASH'], ['2026-11-04', 'FUTURE_CASH']]) {
    const result = spendingCheck(context(), { ...options, today });
    expect(result.status).toBe('incomplete');
    expect(result.expected.spendablePaise).toBeNull();
    expect(result.delayed.canSpend).toBeNull();
    expect(result.recommendedSpendablePaise).toBeNull();
    expect(result.dataQuality.issues.some(i => i.code === code)).toBe(true);
  }
  expect(spendingCheck(context(), { ...options, commitmentsConfirmed: false }).dataQuality.complete).toBe(false);
});

it('reports exact excluded receipt/payment amounts for missing dates, overdue bills and unverified records', () => {
  const result = spendingCheck(context({ cashItems: [
    item('missing', 'payable', 40000, null), item('overdue', 'expense', 7000, '2026-11-05'),
    item('review', 'payable', 5000, '2026-11-08', { confidenceState: 'needs_review', settledPaise: 1000, status: 'partial' }),
    item('undated', 'receivable', 1234, null), item('paid', 'payable', 30000, null, { status: 'paid', settledPaise: 30000 }),
  ] }), options);
  expect(result.dataQuality.excludedPaymentsPaise).toBe(51000);
  expect(result.dataQuality.excludedReceiptsPaise).toBe(1234);
  expect(result.dataQuality.issues.filter(i => i.blocking)).toHaveLength(4);
  expect(result.expected.spendablePaise).toBeNull();
  const missingIssue = result.dataQuality.issues.find(i => i.itemId === 'missing');
  expect(missingIssue.reasonCode).toBe('missing_date');
  expect(missingIssue.totalAmountPaise).toBe(40000);
  expect(result.dataQuality.issues.find(i => i.itemId === 'review').totalAmountPaise).toBe(5000);
});

it('splits installments and residual balance, delays both, and never delays confirmed receipts', () => {
  const input = context({ cashItems: [item('invoice', 'receivable', 80000, '2026-11-25', { settledPaise: 10000, status: 'partial',
    gatewayReceipts: [{ paymentOfferId: 'actual', amountPaise: 10000, date: '2026-11-06' }],
    paymentPromises: [{ id: 'promise', amountPaise: 50000, receivedPaise: 10000, promisedDate: '2026-11-07' }] }),
    item('bill', 'payable', 60000, '2026-11-09')] });
  const original = structuredClone(input);
  const result = spendingCheck(input, options);
  expect(result.expected.includedReceiptsPaise).toBe(80000);
  expect(result.delayed.includedReceiptsPaise).toBe(80000);
  expect(result.delayed.minimumBalancePaise).toBe(50000); // includes confirmed 10000 before wages
  expect(result.delayed.spendablePaise).toBe(30000);
  expect(input).toEqual(original);
});

it('does not revive broken promises or classify fully scheduled invoices as undated', () => {
  const future = item('invoice', 'receivable', 60000, null, {
    paymentPromises: [{ id: 'p', amountPaise: 60000, receivedPaise: 0, promisedDate: '2026-11-07' }] });
  expect(spendingCheck(context({ cashItems: [future] }), options).status).toBe('conditional');
  const missed = { ...future, paymentPromises: [{ ...future.paymentPromises[0], promisedDate: '2026-11-04' }] };
  const result = spendingCheck(context({ cashItems: [missed] }), options);
  expect(result.status).toBe('conditional'); // exclusion is conservative, not an invented receipt
  expect(result.dataQuality.overduePromisesPaise).toBe(60000);
  expect(result.expected.includedReceiptsPaise).toBe(0);
  expect(result.delayed.includedReceiptsPaise).toBe(0);
});

it('excludes late receipts beyond the horizon and counts recurring commitments exactly once', () => {
  const result = spendingCheck(context({ horizonDays: 7, cashItems: [item('r', 'receivable', 50000, '2026-11-07')],
    recurringRules: [{ id: 'rent', description: 'Rent', amountPaise: 30000, active: true, startsOn: '2026-11-01', dayOfMonth: 10 }] }), options);
  expect(result.expected.includedReceiptsPaise).toBe(50000);
  expect(result.delayed.includedReceiptsPaise).toBe(0);
  expect(result.delayed.includedPaymentsPaise).toBe(30000);
  expect(result.delayed.spendablePaise).toBe(50000);
});

it('handles empty ledgers and zero reserve without assuming missing commitments are complete', () => {
  const input = context({ cashItems: [], minimumReservePaise: 0 });
  expect(spendingCheck(input, { ...options, commitmentsConfirmed: false }).expected.spendablePaise).toBeNull();
  expect(spendingCheck(input, options).expected.spendablePaise).toBe(100000);
});

it('rejects unsafe arithmetic and invalid scenario parameters', () => {
  expect(() => spendingCheck(context(), { ...options, delayDays: -1 })).toThrow();
  expect(() => spendingCheck(context(), { ...options, spendPaise: 1.5 })).toThrow();
  expect(() => spendingCheck(context({ openingCashPaise: -Number.MAX_SAFE_INTEGER, minimumReservePaise: 1, cashItems: [] }), options)).toThrow();
});
