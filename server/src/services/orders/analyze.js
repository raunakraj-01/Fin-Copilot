import { z } from 'zod';
import { addDays, horizonEnd, validDate } from '../rescue/dates.js';
import { fail, normalizeContext, parseRequest, runForecast, safeTotal, summarize } from '../rescue/validation.js';

const paise = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const businessDate = z.string().refine(validDate, 'Date must be a valid YYYY-MM-DD date');
const orderSchema = z.object({
  label: z.string().max(200).optional(),
  orderValuePaise: paise.refine(value => value > 0, 'Order value must be positive'),
  advancePaise: paise,
  advanceDate: businessDate,
  finalCollectionDate: businessDate,
  costLines: z.array(z.object({ description: z.string().max(200).optional(), amountPaise: paise, paymentDate: businessDate })).max(100),
  delayedCollectionDays: z.number().int().min(0).max(366).optional(),
}).superRefine((order, context) => {
  if (order.advancePaise > order.orderValuePaise) context.addIssue({ code: 'custom', path: ['advancePaise'], message: 'Advance cannot exceed order value' });
  if (order.finalCollectionDate < order.advanceDate) context.addIssue({ code: 'custom', path: ['finalCollectionDate'], message: 'Final collection cannot precede the advance date' });
});
export function validateOrder(value) {
  const order = parseRequest(orderSchema, value);
  safeTotal([order.orderValuePaise, ...order.costLines.map(line => line.amountPaise)], 'order amounts');
  return order;
}

export function orderEvents(order, advance = order.advancePaise, finalDate = order.finalCollectionDate) {
  return [
    ...(advance ? [{ id: 'order-advance', date: order.advanceDate, direction: 'in', amountPaise: advance, description: 'Conditional customer advance', sourceId: 'proposed-order' }] : []),
    ...(order.orderValuePaise - advance ? [{ id: 'order-final', date: finalDate, direction: 'in', amountPaise: order.orderValuePaise - advance, description: 'Conditional final customer payment', sourceId: 'proposed-order' }] : []),
    ...order.costLines.filter(line => line.amountPaise > 0).map((line, index) => ({ id: `order-cost-${index + 1}`, date: line.paymentDate, direction: 'out', amountPaise: line.amountPaise, description: line.description || 'Order cost', sourceId: 'proposed-order' })),
  ];
}

export function analyzeNewOrder(rawContext, rawOrder, buildForecast) {
  const context = normalizeContext(rawContext);
  const order = structuredClone(validateOrder(rawOrder));
  if (order.advanceDate <= context.asOfDate || order.costLines.some(line => line.paymentDate <= context.asOfDate)) fail('Hypothetical order events must follow the cash snapshot date', 'orderDates');
  safeTotal([Math.abs(context.openingCashPaise), context.minimumReservePaise, order.orderValuePaise, ...order.costLines.map(line => line.amountPaise), ...context.cashItems.map(item => item.amountPaise), ...context.recurringRules.map(rule => rule.amountPaise * Math.ceil(context.horizonDays / 28))], 'combined scenario amounts');
  const reserve = context.minimumReservePaise;
  const end = horizonEnd(context.asOfDate, context.horizonDays);
  const baselineForecast = runForecast(buildForecast, context);
  const baseline = summarize(baselineForecast, reserve);
  const run = (advance, finalDate = order.finalCollectionDate) => runForecast(buildForecast, context, { additionalEvents: orderEvents(order, advance, finalDate) });
  const current = run(order.advancePaise);
  const baselineByDate = new Map(baseline.daily.map(day => [day.date, day.closingCashPaise]));
  function describe(forecast) {
    const snapshot = summarize(forecast, reserve);
    return {
      ...snapshot,
      firstNewBreachDate: snapshot.daily.find(day => day.closingCashPaise < reserve && baselineByDate.get(day.date) >= reserve)?.date ?? null,
      maxIncrementalCashRequirementPaise: Math.max(0, ...snapshot.daily.map(day => baselineByDate.get(day.date) - day.closingCashPaise)),
      maintainsReserve: snapshot.worstCashPaise >= reserve,
    };
  }
  const feasible = forecast => forecast.daily.every(day => day.closingCashPaise >= reserve);
  const fullAdvance = run(order.orderValuePaise);
  let minimumAdvance;
  if (!feasible(fullAdvance)) {
    const breachDate = fullAdvance.daily.find(day => day.closingCashPaise < reserve).date;
    minimumAdvance = {
      possible: false, amountPaise: null, conditionalOnAssumptions: true, breachDate,
      message: breachDate < order.advanceDate
        ? `Cash falls below the reserve on ${breachDate}, before the advance arrives on ${order.advanceDate}`
        : 'Even the full order advance cannot maintain the reserve throughout the forecast horizon',
    };
  } else {
    let low = 0;
    let high = order.orderValuePaise;
    // Since advanceDate <= finalCollectionDate, more advance cannot reduce cash on any day.
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (feasible(run(middle))) high = middle;
      else low = middle + 1;
    }
    minimumAdvance = { possible: true, amountPaise: low, conditionalOnAssumptions: true, scenario: describe(run(low)) };
  }
  const negotiationEnvelope = buildNegotiationEnvelope(order, run, reserve, minimumAdvance);
  const delayedDate = order.delayedCollectionDays ? addDays(order.finalCollectionDate, order.delayedCollectionDays) : null;
  const delayedForecast = delayedDate ? run(order.advancePaise, delayedDate) : null;
  const warnings = [...new Set([...(baselineForecast.warnings ?? []), ...(current.warnings ?? []), ...(delayedForecast?.warnings ?? [])])];
  if (baseline.firstReserveBreachDate) warnings.push(`The existing cash plan breaches the reserve on ${baseline.firstReserveBreachDate} before considering this order; the order is not necessarily the cause.`);
  if (order.advanceDate > end) warnings.push('The proposed advance arrives after the forecast horizon');
  if (order.finalCollectionDate > end) warnings.push('Final customer payment falls outside the forecast horizon');
  if (order.costLines.some(line => line.paymentDate > end)) warnings.push('Some order costs fall outside the forecast horizon; a safe result does not establish affordability after that date');
  if (delayedDate && delayedDate > end) warnings.push('Delayed final payment falls outside the forecast horizon');
  return {
    baseline, withOrder: describe(current), minimumAdvance,
    delayedCustomerScenario: delayedForecast ? { ...describe(delayedForecast), finalCollectionDate: delayedDate } : null,
    negotiationEnvelope,
    warnings,
    assumptions: [...(baselineForecast.assumptions ?? []), 'Order receipts and costs are hypothetical and depend on the entered dates', 'Minimum advance assumes the customer pays the agreed amount on time', 'Cash feasibility is evaluated only within the forecast horizon, using end-of-day balances; it is not a profit or order-acceptance recommendation'],
    asOfDate: context.asOfDate, forecastEndDate: end, minimumReservePaise: reserve,
  };
}

export function buildNegotiationEnvelope(order, run, reserve, minimumAdvance) {
  const options = [];
  const minPct = minimumAdvance.possible
    ? Math.min(100, Math.max(0, Math.ceil((minimumAdvance.amountPaise / order.orderValuePaise) * 100)))
    : null;

  const targetPcts = [20, 30, 40, 50];
  if (minPct != null && !targetPcts.includes(minPct)) {
    targetPcts.push(minPct);
  }
  targetPcts.sort((a, b) => a - b);

  const delayOptions = [0, 15, 30];

  for (const pct of targetPcts) {
    const advancePaise = Math.round((order.orderValuePaise * pct) / 100);
    for (const delayDays of delayOptions) {
      const finalDate = delayDays === 0
        ? order.finalCollectionDate
        : addDays(order.finalCollectionDate, delayDays);
      const forecast = run(advancePaise, finalDate);
      const worstCashPaise = Math.min(...forecast.daily.map(d => d.closingCashPaise));
      const preservesReserve = worstCashPaise >= reserve;
      const headroomPaise = worstCashPaise - reserve;

      options.push({
        advancePct: pct,
        advancePaise,
        delayDays,
        finalCollectionDate: finalDate,
        preservesReserve,
        worstCashPaise,
        headroomPaise,
        isMinimumAdvance: minPct === pct,
      });
    }
  }
  return options;
}
