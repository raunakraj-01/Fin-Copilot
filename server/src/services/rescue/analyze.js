import { addDays, horizonEnd } from './dates.js';
import { currentPromises } from '../finance/promises.js';
import { date, fail, isMoney, money, normalizeContext, runForecast, summarize, validateRescueOptions } from './validation.js';

const outstanding = item => item.amountPaise - item.settledPaise;
const active = item => ['open', 'partial'].includes(item.status) && item.confidenceState !== 'needs_review' && outstanding(item) > 0;
const firstBelow = (daily, threshold) => daily.find(day => day.closingCashPaise < threshold)?.date ?? null;
const breachCount = (daily, threshold) => daily.filter(day => day.closingCashPaise < threshold).length;
const agreementWarning = 'Plan works only if agreed actions happen on assumed dates';
export const costAssumption = 'Known estimated fees are deducted on the entered fee date, or on the proposed action date if no fee date is entered. Unknown fees are excluded and may make a plan infeasible.';

function candidatesFor(context) {
  const end = horizonEnd(context.asOfDate, context.horizonDays);
  return context.cashItems.flatMap(item => {
    const fromDate = item.expectedDate;
    if (!active(item) || !fromDate || fromDate <= context.asOfDate) return [];
    const common = {
      cashItemId: item.id, externalId: item.externalId ?? null, fromDate,
      estimatedCostPaise: item.estimatedActionCostPaise ?? null, requiresAgreement: true, status: 'proposed',
    };
    if (item.category === 'receivable' && item.earliestCollectionDate && isMoney(item.maxEarlyCollectionPaise)) {
      // Invoice-level acceleration cannot safely rewrite multiple installment promises.
      if (currentPromises(item, context.asOfDate).some(p => p.forecastPaise > 0)) return [];
      // Opening cash already includes the snapshot day; a proposed receipt must occur later.
      const firstForecastDay = addDays(context.asOfDate, 1);
      const toDate = item.earliestCollectionDate < firstForecastDay ? firstForecastDay : item.earliestCollectionDate;
      const amountPaise = Math.min(outstanding(item), item.maxEarlyCollectionPaise);
      return amountPaise > 0 && toDate < fromDate && toDate <= end
        ? [{ ...common, type: 'accelerate_collection', amountPaise, toDate }] : [];
    }
    const type = item.category === 'payable' && item.negotiable === true ? 'defer_payable'
      : item.category === 'expense' && item.discretionary === true ? 'delay_expense' : null;
    if (!type || item.mandatory === true || !item.maxExtensionDays || fromDate >= end) return [];
    // A permitted extension can end earlier than its maximum; never hide it beyond the horizon.
    const latest = addDays(fromDate, item.maxExtensionDays);
    return [{ ...common, type, amountPaise: outstanding(item), toDate: latest > end ? end : latest }];
  }).map(action => {
    const item = context.cashItems.find(item => item.id === action.cashItemId);
    return { ...action, feeDate: item.actionCostDate || action.toDate };
  }).sort((a, b) => b.amountPaise - a.amountPaise || a.cashItemId.localeCompare(b.cashItemId));
}

export function makeCandidates(context, maxCandidates = 12) {
  validateRescueOptions({ maxCandidates });
  return candidatesFor(normalizeContext(context)).slice(0, maxCandidates);
}

export function applyActions(context, actions) {
  const base = normalizeContext(context);
  const end = horizonEnd(base.asOfDate, base.horizonDays);
  const selected = new Map();
  if (!Array.isArray(actions)) fail('actions must be an array', 'actions');
  for (const action of actions) {
    if (!action || selected.has(action.cashItemId)) fail('Only one action per cash item is permitted', 'actions');
    const item = base.cashItems.find(value => value.id === action.cashItemId);
    if (!item || !active(item)) fail('Action must reference an eligible open cash item', 'actions.cashItemId');
    date(action.toDate, 'actions.toDate');
    money(action.amountPaise, 'actions.amountPaise');
    if (action.fromDate !== item.expectedDate || !item.expectedDate || item.expectedDate <= base.asOfDate || action.toDate <= base.asOfDate || action.toDate > end) fail('Action date is outside the allowed timeline', 'actions.toDate');
    if (action.type === 'accelerate_collection') {
      if (currentPromises(item, base.asOfDate).some(p => p.forecastPaise > 0)) fail('Revise this invoice’s payment promises before simulating early collection', 'actions');
      if (item.category !== 'receivable' || !item.earliestCollectionDate || !isMoney(item.maxEarlyCollectionPaise) || action.toDate < item.earliestCollectionDate || action.toDate >= item.expectedDate || action.amountPaise <= 0 || action.amountPaise > Math.min(outstanding(item), item.maxEarlyCollectionPaise)) fail('Collection action exceeds invoice constraints', 'actions');
    } else {
      const allowed = action.type === 'defer_payable' && item.category === 'payable' && item.negotiable === true
        || action.type === 'delay_expense' && item.category === 'expense' && item.discretionary === true;
      if (!allowed || item.mandatory === true || !item.maxExtensionDays || action.toDate <= item.expectedDate || action.toDate > addDays(item.expectedDate, item.maxExtensionDays) || action.amountPaise !== outstanding(item)) fail('Payment deferral violates item constraints', 'actions');
    }
    selected.set(item.id, action);
  }
  const usedIds = new Set(base.cashItems.map(item => item.id));
  return base.cashItems.flatMap(item => {
    const action = selected.get(item.id);
    if (!action) return [structuredClone(item)];
    if (action.type !== 'accelerate_collection' || action.amountPaise === outstanding(item)) return [{ ...structuredClone(item), expectedDate: action.toDate }];
    let splitId = `${item.id}:early`;
    while (usedIds.has(splitId)) splitId += ':split';
    usedIds.add(splitId);
    return [
      { ...structuredClone(item), amountPaise: item.amountPaise - action.amountPaise },
      { ...structuredClone(item), id: splitId, _id: splitId, sourceId: item.id, sourceCashItemId: item.id, amountPaise: action.amountPaise, settledPaise: 0, gatewayReceipts: [], status: 'open', expectedDate: action.toDate },
    ];
  });
}

export function actionFeeEvents(context, actions) {
  const base = normalizeContext(context);
  return actions.flatMap(action => {
    const item = base.cashItems.find(item => item.id === action.cashItemId);
    if (!item) fail('Unknown fee source', 'cashItemId');
    const amountPaise = item.estimatedActionCostPaise;
    if (amountPaise == null || amountPaise === 0) return [];
    const feeDate = item.actionCostDate || action.toDate;
    date(feeDate, 'actionCostDate');
    if (feeDate <= base.asOfDate || feeDate > horizonEnd(base.asOfDate, base.horizonDays)) fail('Known action fees must fall after the snapshot and within the forecast horizon', 'actionCostDate');
    return [{ id: `fee:${item.id}`, cashItemId: item.id, externalId: item.externalId,
      date: feeDate, direction: 'out', amountPaise, reason: 'rescue_fee', confidenceState: 'owner_assumption' }];
  });
}

export function analyzeRescue(rawContext, options = {}, buildForecast) {
  const context = normalizeContext(rawContext);
  const { objective, maxCandidates, maxPlans } = validateRescueOptions(options);
  const baselineForecast = runForecast(buildForecast, context);
  const baseline = summarize(baselineForecast, context.minimumReservePaise);
  const threshold = objective === 'minimum_reserve' ? context.minimumReservePaise : 0;
  const warnings = [...(baselineForecast.warnings ?? [])];
  const assumptions = [...(baselineForecast.assumptions ?? []), agreementWarning, costAssumption];
  const baseResult = { baseline, objective, minimumReservePaise: context.minimumReservePaise, warnings, assumptions, plans: [], partialMitigations: [] };
  if (baseline.worstCashPaise >= threshold) return { ...baseResult, candidateCount: 0, candidates: [], evaluatedCombinationCount: 0, message: 'The current forecast already meets this cash objective; no rescue action is needed', rankingRationale: null };
  const available = candidatesFor(context);
  const candidates = available.slice(0, maxCandidates);
  if (available.length > candidates.length) warnings.push(`Search limited to ${candidates.length} of ${available.length} candidate actions, prioritized by amount. Other combinations may exist.`);
  const complete = [];
  const partial = [];
  const baselineBreachDays = breachCount(baseline.daily, threshold);
  let evaluatedCombinationCount = 0;
  for (let mask = 1; mask < 2 ** candidates.length; mask++) {
    const actions = candidates.filter((_, index) => mask & (1 << index));
    if (new Set(actions.map(action => action.cashItemId)).size !== actions.length) continue;
    const forecast = runForecast(buildForecast, context, { cashItems: applyActions(context, actions), additionalEvents: actionFeeEvents(context, actions) });
    evaluatedCombinationCount++;
    const after = summarize(forecast, context.minimumReservePaise);
    const containsUnknownCosts = actions.some(action => action.estimatedCostPaise === null);
    const knownActionCostPaise = actions.reduce((sum, action) => sum + (action.estimatedCostPaise ?? 0), 0);
    if (!Number.isSafeInteger(knownActionCostPaise)) fail('Combined action costs exceed safe integer arithmetic', 'estimatedActionCostPaise');
    const plan = {
      planId: `simulation-${mask}`, fullyFeasible: after.worstCashPaise >= threshold,
      feasibility: 'conditional', worstCashPaiseAfter: after.worstCashPaise,
      knownActionCostPaise, estimatedTotalCostPaise: containsUnknownCosts ? null : knownActionCostPaise,
      containsUnknownCosts, actions, daily: after.daily,
      firstNegativeDateAfter: after.firstNegativeDate, firstReserveBreachDateAfter: after.firstReserveBreachDate,
      warnings: [...(forecast.warnings ?? []), agreementWarning, costAssumption, ...(containsUnknownCosts ? ['Some action costs are unknown; this is not a globally cheapest-plan guarantee'] : [])],
    };
    if (plan.fullyFeasible) complete.push(plan);
    else {
      const improvementPaise = after.worstCashPaise - baseline.worstCashPaise;
      const breachDaysReduced = baselineBreachDays - breachCount(after.daily, threshold);
      if (improvementPaise >= 0 && (improvementPaise > 0 || breachDaysReduced > 0)) partial.push({ ...plan, feasibility: 'insufficient', improvementPaise, breachDaysReduced, firstBreachAfter: firstBelow(after.daily, threshold), partialReason: improvementPaise > 0 ? 'Reduces the worst shortfall but does not meet the objective' : 'Reduces days in shortage but does not reduce the worst shortfall' });
    }
  }
  complete.sort((a, b) => Number(a.containsUnknownCosts) - Number(b.containsUnknownCosts) || a.knownActionCostPaise - b.knownActionCostPaise || a.actions.length - b.actions.length || b.worstCashPaiseAfter - a.worstCashPaiseAfter);
  partial.sort((a, b) => b.improvementPaise - a.improvementPaise || b.breachDaysReduced - a.breachDaysReduced || a.actions.length - b.actions.length);
  return {
    ...baseResult, candidateCount: candidates.length, candidates, evaluatedCombinationCount,
    plans: complete.slice(0, maxPlans), partialMitigations: complete.length ? [] : partial.slice(0, maxPlans),
    message: complete.length ? null : 'No feasible plan found under entered constraints among the tested combinations across the full horizon',
    rankingRationale: 'Fully known costs first, then lower known cost, fewer actions, and more cash headroom. Unknown costs can change this ranking; search is limited to the displayed candidates.',
  };
}
