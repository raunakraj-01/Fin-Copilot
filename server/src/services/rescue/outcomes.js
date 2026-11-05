import { buildForecast } from '../finance/forecast.js';
import { currentPromises, itemPromiseStates } from '../finance/promises.js';
import { applyActions } from './analyze.js';
import { addDays, horizonEnd } from './dates.js';
import { normalizeContext, safeTotal } from './validation.js';

// Saved amounts remain an audit snapshot. Live projections are rebuilt from current
// records on every read; no cached monetary result can survive a ledger change.
export function evaluatePlan(rawContext, plan) {
  const context = normalizeContext(rawContext);
  const baseline = buildForecast(context);
  let items = context.cashItems.map(item => ({ ...item }));
  const fees = [];
  const warnings = [];
  const actions = [];
  const signals = [];
  let needsReview = (context.bankReviewIssues || []).length > 0;
  const end = horizonEnd(context.asOfDate, context.horizonDays);
  for (const item of context.cashItems) {
    for (const p of currentPromises(item, context.asOfDate)) {
      if (p.forecastPaise > 0 && p.promisedDate < context.asOfDate)
        signals.push({ type: 'broken_promise', cashItemId: item.id, promiseId: p.id, amountPaise: p.forecastPaise, date: p.promisedDate });
    }
  }
  for (const action of plan.actions) {
    const id = String(action.cashItemId);
    const item = context.cashItems.find(i => i.id === id);
    const remainingInvoice = item ? Math.max(0, item.amountPaise - item.settledPaise) : 0;
    const observedSettlementPaise = item && action.baselineSettledPaise != null ? Math.max(0, item.settledPaise - action.baselineSettledPaise) : 0;
    const outcome = { actionId: action.actionId, cashItemId: id, status: 'pending_agreement', applied: false,
      sourceLabel: item?.externalId || item?.counterparty || id,
      observedSettlementPaise, remainingActionPaise: action.type === 'accelerate_collection'
        ? Math.min(remainingInvoice, Math.max(0, action.amountPaise - observedSettlementPaise)) : remainingInvoice,
      availablePromises: item ? itemPromiseStates(item, context.asOfDate).map(p => ({ id: p.id, amountPaise: p.amountPaise,
        remainingPaise: p.remainingPaise, promisedDate: p.promisedDate, status: p.status })) : [], messages: [] };
    const review = message => { needsReview = true; outcome.status = 'needs_review'; outcome.messages.push(message); warnings.push(message); };
    const includeFee = () => {
      if (action.estimatedCostPaise == null) review('Action cost is unknown. Current projection excludes the unknown fee.');
      else if (action.estimatedCostPaise > 0) {
        if (!action.feeDate || action.feeDate <= context.asOfDate || action.feeDate > end) review('Check the action fee against current cash records; its saved date is past or outside the horizon.');
        else fees.push({ id: `rescue-fee:${action.actionId}`, date: action.feeDate, direction: 'out', amountPaise: action.estimatedCostPaise, reason: 'rescue_fee', confidenceState: 'owner_assumption' });
      }
    };
    actions.push(outcome);
    if (observedSettlementPaise > 0) signals.push({ type: remainingInvoice ? 'partial_payment' : 'settled', cashItemId: id, actionId: action.actionId, amountPaise: observedSettlementPaise });
    if (action.status === 'rejected') {
      outcome.status = 'rejected';
      signals.push({ type: action.type === 'defer_payable' ? 'rejected_extension' : 'rejected_action', actionId: action.actionId, cashItemId: id });
      // A rejected collection must not retain its linked early-payment expectation.
      if (item && action.promiseId) items = items.map(i => i.id === id ? { ...i, paymentPromises: (i.paymentPromises || []).map(p => String(p._id || p.id) === action.promiseId ? { ...p, closedAs: 'cancelled' } : p) } : i);
      if (item && action.type !== 'accelerate_collection' && item.expectedDate === action.toDate)
        items = items.map(i => i.id === id ? { ...i, expectedDate: action.fromDate } : i);
      continue;
    }
    if (!item) { review('A rescue action references a deleted cash record. Rebuild this plan.'); continue; }
    if (item.status === 'cancelled') { review(`${item.externalId || item.counterparty}: source record was cancelled. Review this action.`); continue; }
    if (!remainingInvoice) {
      outcome.status = 'settled';
      if (['agreed', 'completed'].includes(action.status) && plan.status !== 'abandoned') includeFee();
      continue;
    }
    if (item.confidenceState === 'needs_review') { review(`${item.externalId || item.counterparty}: source record needs verification.`); continue; }
    if (plan.status === 'abandoned') { outcome.status = 'plan_abandoned'; continue; }
    if (!['agreed', 'completed'].includes(action.status)) continue;
    if (action.type === 'accelerate_collection' && action.promiseId) {
      const promise = itemPromiseStates(item, context.asOfDate).find(p => p.id === action.promiseId);
      if (!promise) { review('Linked payment promise was deleted. Link a current promise.'); continue; }
      outcome.remainingActionPaise = Math.min(remainingInvoice, promise.remainingPaise);
      outcome.status = promise.status === 'broken' || promise.promisedDate <= context.asOfDate && promise.remainingPaise > 0
        ? 'broken_promise' : promise.status === 'fulfilled' ? 'payment_observed' : promise.closedAs ? 'promise_changed' : 'tracking_promise';
      outcome.messages.push('Linked promise and confirmed receipts are already included in the current cash forecast; no additional receipt is added.');
      if (promise.closedAs || promise.status === 'review_external_settlement') review('Linked promise was revised, cancelled or affected by another settlement. Review its replacement and relink this action.');
      else if (promise.promisedDate !== action.toDate || promise.amountPaise !== action.amountPaise)
        outcome.messages.push(`Current linked promise is ${promise.amountPaise / 100} INR by ${promise.promisedDate}; the current projection uses those terms instead of the original saved terms.`);
    } else if (action.type === 'accelerate_collection' && currentPromises(item, context.asOfDate).some(p => p.forecastPaise > 0)) {
      review('This invoice now has payment promises. Link the appropriate promise instead of assuming another early receipt.');
      continue;
    } else {
      if (outcome.remainingActionPaise === 0) { outcome.status = 'payment_observed'; includeFee(); continue; }
      if (action.toDate <= context.asOfDate) { outcome.status = 'missed'; outcome.messages.push('Action date has passed with an outstanding balance. Its projected benefit is removed.'); continue; }
      if (action.toDate > end) { review('Action date falls outside the current forecast horizon.'); continue; }
      if (item.expectedDate === action.toDate) { outcome.status = 'already_recorded'; }
      else if (item.expectedDate !== action.fromDate) { review('Source expected date changed since this plan was saved. Rebuild or relink the action.'); continue; }
      else {
        try {
          // An agreed extension can remain valid after its original due date. Validate
          // against the original terms, then overlay only its still-outstanding balance.
          const validationDate = action.fromDate <= context.asOfDate ? addDays(action.fromDate, -1) : context.asOfDate;
          const adapted = { cashItemId: id, type: action.type, amountPaise: outcome.remainingActionPaise,
            fromDate: action.fromDate, toDate: action.toDate };
          const validated = applyActions({ ...context, asOfDate: validationDate, horizonDays: 366, cashItems: [item] }, [adapted]);
          // Keep source receipt IDs only on the original portion. Confirmed cash is
          // never cloned into the hypothetical accelerated portion.
          items = items.filter(i => i.id !== id).concat(validated);
          outcome.status = observedSettlementPaise ? 'partial_payment' : 'agreed'; outcome.applied = true;
        } catch (error) { review(`Action no longer meets the source constraints: ${error.message}`); continue; }
      }
    }
    if (action.status === 'completed') outcome.messages.push('Completed is an owner status, not proof of payment. Only the cash record or linked promise confirms receipt.');
    includeFee();
    if (observedSettlementPaise) outcome.messages.push('New invoice settlements reduce the remaining collection target. Recorded receipts are included once; payments before the snapshot must already be in opening cash.');
    if (action.baselineSettledPaise == null && item.settledPaise > 0 && !action.promiseId)
      review('Legacy plan has no starting settlement balance. Verify payment outcomes and rebuild or link a promise.');
  }
  // Do not hide outstanding, undated or overdue outgoing commitments simply because
  // the original date was missed. Hold them on the next day pending owner review.
  items = items.map(item => {
    if (item.category !== 'receivable' && ['open', 'partial'].includes(item.status) && item.amountPaise > item.settledPaise
      && (!item.expectedDate || item.expectedDate <= context.asOfDate || item.confidenceState === 'needs_review')) {
      needsReview = true;
      warnings.push(`${item.externalId || item.counterparty}: an unpaid outgoing commitment needs a new verified date; provisionally included on the next day.`);
      return { ...item, expectedDate: addDays(context.asOfDate, 1), confidenceState: 'owner_assumption' };
    }
    return item;
  });
  safeTotal([Math.abs(context.openingCashPaise), context.minimumReservePaise, ...items.map(i => i.amountPaise),
    ...fees.map(f => f.amountPaise), ...context.recurringRules.map(r => r.amountPaise * Math.ceil(context.horizonDays / 28))], 'live plan cash');
  const forecast = buildForecast({ ...context, cashItems: items, additionalEvents: fees });
  const threshold = plan.objective === 'minimum_reserve' ? context.minimumReservePaise : 0;
  const summary = value => ({ minimumCashPaise: value.risk.worstCashPaise, minimumDate: value.risk.worstDate,
    firstReserveBreachDate: value.risk.firstReserveBreachDate, firstNegativeDate: value.risk.firstNegativeDate,
    gapPaise: Math.max(0, threshold - value.risk.worstCashPaise) });
  return { evaluatedAsOfDate: context.asOfDate, horizonEnd: end, calculatedAt: new Date().toISOString(), objective: plan.objective, minimumReservePaise: context.minimumReservePaise,
    status: needsReview ? 'needs_review' : forecast.risk.worstCashPaise < threshold ? 'insufficient' : 'conditional',
    baseline: summary(baseline), current: summary(forecast), actions, signals,
    affectedPayments: forecast.daily.flatMap(day => day.closingCashPaise < threshold ? day.events.filter(e => e.direction === 'out')
      .map(e => ({ date: e.date, label: e.externalId || e.description || e.counterparty || e.id, amountPaise: e.amountPaise,
        gapPaise: Math.max(0, threshold - day.closingCashPaise) })) : []),
    warnings: [...new Set([...warnings, ...forecast.warnings])],
    assumptions: ['Only agreed or owner-completed actions affect this conditional plan projection. Rejected, proposed and requested actions add no assumed benefit.',
      'Each plan is evaluated separately. Benefits from alternative saved plans must not be added together.',
      'Live plan projections do not change the ledger or the original saved calculation. Payment promises and actual receipts remain the sources for collection outcomes.'] };
}
