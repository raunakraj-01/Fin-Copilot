import { expect, it } from 'vitest';
import { evaluatePlan } from '../src/services/rescue/outcomes.js';
const context = (changes = {}) => ({ asOfDate: '2026-11-01', horizonDays: 30, openingCashPaise: 20000, minimumReservePaise: 0,
  cashItems: [{ id: 'bill', category: 'payable', status: 'open', amountPaise: 60000, settledPaise: 0, expectedDate: '2026-11-05', negotiable: true, maxExtensionDays: 10 },
    { id: 'invoice', category: 'receivable', status: 'open', amountPaise: 100000, settledPaise: 0, expectedDate: '2026-11-10', earliestCollectionDate: '2026-11-02', maxEarlyCollectionPaise: 60000 }], ...changes });
const extension = { actionId: 'extension', cashItemId: 'bill', type: 'defer_payable', fromDate: '2026-11-05', toDate: '2026-11-15',
  amountPaise: 60000, baselineSettledPaise: 0, estimatedCostPaise: 0, feeDate: '2026-11-15', status: 'agreed' };
const collection = { actionId: 'collection', cashItemId: 'invoice', type: 'accelerate_collection', fromDate: '2026-11-10', toDate: '2026-11-03',
  amountPaise: 60000, baselineSettledPaise: 0, estimatedCostPaise: 0, feeDate: '2026-11-03', status: 'agreed' };
const plan = actions => ({ objective: 'nonnegative', status: 'in_progress', actions });

it('removes rejected/unagreed extensions and never changes the saved snapshot or ledger', () => {
  const input = context(); const saved = { ...plan([extension]), simulatedWorstCashPaise: 1234 };
  const original = structuredClone({ input, saved });
  expect(evaluatePlan(input, saved).current.minimumCashPaise).toBe(20000);
  for (const status of ['rejected', 'requested', 'proposed']) {
    const live = evaluatePlan(input, plan([{ ...extension, status }]));
    expect(live.current.minimumCashPaise).toBe(-40000);
    expect(live.actions[0].applied).toBe(false);
  }
  expect({ input, saved }).toEqual(original);
});

it('recalculates partial collections without cloning confirmed receipts into the accelerated part', () => {
  const input = context(); const invoice = input.cashItems[1];
  Object.assign(invoice, { settledPaise: 20000, status: 'partial', gatewayReceipts: [{ paymentOfferId: 'actual', date: '2026-11-02', amountPaise: 20000 }] });
  const live = evaluatePlan(input, plan([collection]));
  expect(live.actions[0]).toMatchObject({ status: 'partial_payment', observedSettlementPaise: 20000, remainingActionPaise: 40000 });
  expect(live.current.minimumCashPaise).toBe(20000); // not 40000 from a duplicated receipt
  expect(live.signals).toContainEqual(expect.objectContaining({ type: 'partial_payment', amountPaise: 20000 }));
});

it('tracks a linked promise, detects its break and uses actual partial receipts only once', () => {
  const input = context();
  input.cashItems[1].paymentPromises = [{ id: 'promise', amountPaise: 60000, promisedDate: '2026-11-03', receivedPaise: 0 }];
  const saved = plan([{ ...collection, promiseId: 'promise' }]);
  expect(evaluatePlan(input, saved).actions[0].status).toBe('tracking_promise');
  const future = { ...input, asOfDate: '2026-11-04' };
  let live = evaluatePlan(future, saved);
  expect(live.actions[0].status).toBe('broken_promise');
  expect(live.current.minimumCashPaise).toBe(-40000);
  expect(live.affectedPayments).toContainEqual(expect.objectContaining({ date: '2026-11-05', amountPaise: 60000 }));
  Object.assign(input.cashItems[1], { settledPaise: 20000, status: 'partial', gatewayReceipts: [{ paymentOfferId: 'receipt', date: '2026-11-05', amountPaise: 20000 }] });
  input.cashItems[1].paymentPromises[0].receivedPaise = 20000;
  live = evaluatePlan(future, saved);
  expect(live.current.minimumCashPaise).toBe(-20000);
  expect(live.actions[0].remainingActionPaise).toBe(40000);
});

it('retains an agreed extension past its original due date but provisions it after rejection or missed extension', () => {
  const input = context({ asOfDate: '2026-11-06' });
  expect(evaluatePlan(input, plan([extension])).current.minimumCashPaise).toBe(20000);
  const rejected = evaluatePlan(input, plan([{ ...extension, status: 'rejected' }]));
  expect(rejected.status).toBe('needs_review');
  expect(rejected.current.minimumCashPaise).toBe(-40000);
  expect(rejected.affectedPayments[0].date).toBe('2026-11-07');
  const missed = evaluatePlan(context({ asOfDate: '2026-11-16' }), plan([extension]));
  expect(missed.actions[0].status).toBe('missed');
  expect(missed.current.minimumCashPaise).toBe(-40000);
});

it('does not let completed status invent payments and flags changed constraints or unknown fees', () => {
  const completed = evaluatePlan(context(), plan([{ ...collection, status: 'completed' }]));
  expect(completed.actions[0].status).toBe('agreed');
  expect(completed.actions[0].messages.join(' ')).toContain('not proof of payment');
  const changed = context(); changed.cashItems[0].mandatory = true;
  expect(evaluatePlan(changed, plan([extension])).status).toBe('needs_review');
  expect(evaluatePlan(context(), plan([{ ...extension, estimatedCostPaise: null }])).status).toBe('needs_review');
});

it('requires relinking changed promises and handles deleted source records safely', () => {
  const input = context(); input.cashItems[1].paymentPromises = [{ id: 'promise', amountPaise: 60000, promisedDate: '2026-11-03', receivedPaise: 0, closedAs: 'superseded' }];
  expect(evaluatePlan(input, plan([{ ...collection, promiseId: 'promise' }])).status).toBe('needs_review');
  expect(evaluatePlan(context({ cashItems: [] }), plan([extension])).status).toBe('needs_review');
});

it('restores original outgoing timing when a rejected extension was already copied into the ledger', () => {
  const input = context(); input.cashItems[0].expectedDate = extension.toDate;
  const live = evaluatePlan(input, plan([{ ...extension, status: 'rejected' }]));
  expect(live.current.minimumCashPaise).toBe(-40000);
  expect(live.current.firstNegativeDate).toBe('2026-11-05');
});
