import { z } from 'zod';
import { analyzeRescue, applyActions, actionFeeEvents, makeCandidates, costAssumption } from '../rescue/analyze.js';
import { addDays, horizonEnd } from '../rescue/dates.js';
import { normalizeContext, parseRequest, runForecast, summarize, fail } from '../rescue/validation.js';

const optionsSchema = z.object({
  counterparty: z.string().trim().min(1).max(200).optional(),
  delayDays: z.union([z.literal(7), z.literal(15), z.literal(30)]).default(7),
}).strict();
export const validateShock = value => parseRequest(optionsSchema, value);
const pending = item => item.category === 'receivable' && ['open', 'partial'].includes(item.status)
  && item.confidenceState !== 'needs_review' && item.amountPaise > item.settledPaise;

function metrics(forecast, reserve) {
  const summary = summarize(forecast, reserve);
  return { ...summary, peakGapPaise: Math.max(0, reserve - summary.worstCashPaise),
    breachDays: summary.daily.filter(day => day.closingCashPaise < reserve).length };
}

export function delayReceipts(items, counterparty, days, asOfDate) {
  return items.map(item => pending(item) && item.counterparty === counterparty && item.expectedDate > asOfDate
    ? { ...item, expectedDate: addDays(item.expectedDate, days) } : { ...item });
}

export function analyzeShock(rawContext, rawOptions = {}, buildForecast) {
  const context = normalizeContext(rawContext);
  const options = validateShock(rawOptions);
  const customers = [...new Set(context.cashItems.filter(item => pending(item) && item.expectedDate > context.asOfDate).map(item => item.counterparty).filter(Boolean))].sort();
  const counterparty = options.counterparty ?? customers[0] ?? null;
  if (options.counterparty && !customers.includes(options.counterparty)) fail('Select a customer with a dated open receivable in this workspace', 'counterparty');
  const reserve = context.minimumReservePaise;
  const end = horizonEnd(context.asOfDate, context.horizonDays);
  const baselineForecast = runForecast(buildForecast, context);
  const baseline = metrics(baselineForecast, reserve);
  const shifted = delayReceipts(context.cashItems, counterparty, options.delayDays, context.asOfDate);
  const stressed = metrics(runForecast(buildForecast, context, { cashItems: shifted }), reserve);
  const movedReceipts = shifted.filter((item, index) => item.expectedDate !== context.cashItems[index].expectedDate)
    .map(item => ({ cashItemId: item.id, externalId: item.externalId, fromDate: context.cashItems.find(source => source.id === item.id).expectedDate,
      toDate: item.expectedDate, amountPaise: item.amountPaise - item.settledPaise, outsideHorizon: item.expectedDate > end }));
  const rescue = analyzeRescue(context, { objective: 'minimum_reserve', maxCandidates: 12, maxPlans: 3 }, buildForecast);
  const plans = (rescue.plans.length ? rescue.plans : rescue.partialMitigations).map((plan, index) => {
    const items = applyActions(context, plan.actions);
    const fees = actionFeeEvents(context, plan.actions);
    const scenarios = [7, 15, 30].map(delayDays => {
      const changed = delayReceipts(items, counterparty, delayDays, context.asOfDate);
      const result = metrics(runForecast(buildForecast, context, { cashItems: changed, additionalEvents: fees }), reserve);
      return { delayDays, ...result, passes: result.peakGapPaise === 0,
        receiptsBeyondHorizon: changed.filter(item => pending(item) && item.counterparty === counterparty && item.expectedDate > end).length };
    });
    return { ...plan, label: `${plan.fullyFeasible ? 'Plan' : 'Mitigation'} ${index + 1}`, scenarios,
      passingScenarios: scenarios.filter(scenario => scenario.passes).length };
  });
  // shortcut: evaluate the same bounded candidates as rescue; expand only after measuring larger ledgers.
  const priorities = makeCandidates(context).filter(action => action.type === 'accelerate_collection').map(action => {
    const after = metrics(runForecast(buildForecast, context, { cashItems: applyActions(context, [action]), additionalEvents: actionFeeEvents(context, [action]) }), reserve);
    const item = context.cashItems.find(item => item.id === action.cashItemId);
    return { ...action, counterparty: item.counterparty, breachDaysReduced: baseline.breachDays - after.breachDays,
      peakGapReductionPaise: baseline.peakGapPaise - after.peakGapPaise, remainingGapPaise: after.peakGapPaise,
      firstBreachAfter: after.firstReserveBreachDate };
  }).sort((a, b) => b.breachDaysReduced - a.breachDaysReduced || b.peakGapReductionPaise - a.peakGapReductionPaise || a.cashItemId.localeCompare(b.cashItemId))
    .filter(action => action.breachDaysReduced > 0 || action.peakGapReductionPaise > 0).slice(0, 3);
  return { asOfDate: context.asOfDate, forecastEndDate: end, minimumReservePaise: reserve,
    customers, counterparty, delayDays: options.delayDays, baseline, stressed, movedReceipts, plans, priorities,
    sources: context.cashItems.map(item => ({ id: item.id, label: item.externalId || item.counterparty || item.id,
      counterparty: item.counterparty, expectedDate: item.expectedDate, outstandingPaise: item.amountPaise - item.settledPaise,
      confidenceState: item.confidenceState || 'owner_assumption' })),
    warnings: [...new Set([...rescue.warnings, ...baselineForecast.warnings,
      ...(!counterparty ? ['No customer has a dated open receivable to stress. Add or review records in Setup.'] : []),
      ...(movedReceipts.some(item => item.outsideHorizon) ? ['Delayed receipts beyond the forecast horizon are excluded from displayed cash, not cancelled.'] : [])])],
    assumptions: [costAssumption, 'All dated open receipts from the selected customer, including negotiated early portions, receive the same delay. Mandatory payments and fee dates stay fixed.',
      'Pass counts describe three chosen scenarios, not probabilities. Only the top returned baseline rescue plans are stress-tested; other plans may exist.',
      'Collection priorities use the original forecast, assume agreement, and are ranked by days below reserve removed, then peak gap reduction. Individual benefits cannot be added together.'],
  };
}
