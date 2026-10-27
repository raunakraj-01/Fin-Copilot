import { z } from 'zod';
import { applyActions } from './analyze.js';
import { normalizeContext, parseRequest, runForecast, safeTotal, summarize } from './validation.js';

const actionSchema = z.object({
  cashItemId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'cashItemId must be a MongoDB object ID'),
  type: z.enum(['accelerate_collection', 'defer_payable', 'delay_expense']),
  amountPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  fromDate: z.string(),
  toDate: z.string(),
});
const requestSchema = z.object({
  objective: z.enum(['nonnegative', 'minimum_reserve']),
  actions: z.array(actionSchema).min(1).max(12),
});
export const validateSavePlanRequest = value => parseRequest(requestSchema, value);

// Rebuild all financial figures from current records. A browser cannot supply balances or costs.
export function prepareSavedPlan(rawContext, rawRequest, buildForecast) {
  const context = normalizeContext(rawContext);
  const request = validateSavePlanRequest(rawRequest);
  const items = applyActions(context, request.actions);
  const baseline = summarize(runForecast(buildForecast, context), context.minimumReservePaise);
  const scenario = runForecast(buildForecast, context, { cashItems: items });
  const after = summarize(scenario, context.minimumReservePaise);
  const threshold = request.objective === 'minimum_reserve' ? context.minimumReservePaise : 0;
  const actions = request.actions.map((action, index) => {
    const item = context.cashItems.find(item => item.id === action.cashItemId);
    return {
      actionId: `action-${index + 1}`,
      cashItemId: item.id,
      type: action.type,
      amountPaise: action.amountPaise,
      fromDate: action.fromDate,
      toDate: action.toDate,
      estimatedCostPaise: item.estimatedActionCostPaise ?? null,
      status: 'proposed',
      ownerNotes: '',
    };
  });
  const containsUnknownCosts = actions.some(action => action.estimatedCostPaise == null);
  safeTotal(actions.map(action => action.estimatedCostPaise ?? 0), 'estimatedActionCostPaise');
  const estimatedTotalCostPaise = containsUnknownCosts ? null : actions.reduce((total, action) => total + action.estimatedCostPaise, 0);
  return {
    asOfDate: context.asOfDate,
    objective: request.objective,
    status: 'proposed',
    baselineWorstCashPaise: baseline.worstCashPaise,
    simulatedWorstCashPaise: after.worstCashPaise,
    estimatedTotalCostPaise,
    containsUnknownCosts,
    feasibility: after.worstCashPaise >= threshold ? 'conditional' : 'insufficient',
    actions,
    planWarnings: [...new Set([...(scenario.warnings ?? []), 'Actions require agreement; saving this plan does not change cash records', 'Estimated action fees have no payment dates and are not deducted from the forecast'])],
  };
}
