import { buildForecast } from './forecast.js';
import { loadDecisionContext } from '../rescue/decisionContext.js';
import ProcurementRequest from '../../models/ProcurementRequest.js';
import { fail } from '../../utils/http.js';

const summary = forecast => ({
  firstReserveBreachDate: forecast.risk.firstReserveBreachDate,
  firstNegativeDate: forecast.risk.firstNegativeDate,
  worstCashPaise: forecast.risk.worstCashPaise,
  worstDate: forecast.risk.worstDate,
});

export async function analyzeProcurement(workspaceId, request, options = {}) {
  const context = await (options.loadContext || loadDecisionContext)(workspaceId);
  if (!context) fail(404, 'NOT_FOUND', 'Business not found');
  const commitmentRows = await (options.listCommitments || (id => ProcurementRequest.find({
    workspaceId: id, status: { $in: ['approved', 'ordered', 'received'] }, planningCommitmentId: { $type: 'string' },
  }).lean()))(workspaceId);
  const existing = commitmentRows.filter(row => String(row._id) !== String(request._id));
  const committedEvents = existing.map(row => ({ id: row.planningCommitmentId, sourceId: row.planningCommitmentId,
    date: row.paymentDueDate, direction: 'out', amountPaise: row.quoteAmountPaise || row.estimatedAmountPaise,
    description: `Approved purchase commitment - ${row.name}`, counterparty: row.supplier }));
  const baseline = (options.buildForecast || buildForecast)({ ...context, additionalEvents: committedEvents });
  const amountPaise = request.quoteAmountPaise || request.estimatedAmountPaise;
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 1) fail(400, 'VALIDATION_ERROR', 'A positive supplier amount is required before cash analysis');
  if (request.paymentDueDate <= context.asOfDate) fail(400, 'VALIDATION_ERROR', 'Supplier payment date must follow the current cash snapshot');
  const endDate = baseline.daily.at(-1)?.date || context.asOfDate;
  const dateInHorizon = request.paymentDueDate <= endDate;
  const event = { id: `procurement:${request._id}`, sourceId: request.planningCommitmentId || `procurement:${request._id}`,
    date: request.paymentDueDate, direction: 'out', amountPaise,
    description: `Proposed purchase - ${request.name}`, counterparty: request.supplier };
  const proposed = (options.buildForecast || buildForecast)({ ...context,
    additionalEvents: [...committedEvents, ...(dateInHorizon ? [event] : [])] });
  const baselineRisk = summary(baseline);
  const proposedRisk = summary(proposed);
  const incrementalReserveBreachDate = proposed.daily.find((day, index) => day.closingCashPaise < context.minimumReservePaise
    && baseline.daily[index]?.closingCashPaise >= context.minimumReservePaise)?.date || null;
  const worsensWorstCash = proposedRisk.worstCashPaise < baselineRisk.worstCashPaise;
  const warnings = [];
  if (!dateInHorizon) warnings.push('Supplier payment date falls outside the forecast horizon; cash safety cannot be confirmed.');
  if (baselineRisk.firstReserveBreachDate) warnings.push(`Other cash commitments already breach the reserve on ${baselineRisk.firstReserveBreachDate}.`);
  if (incrementalReserveBreachDate) warnings.push(`This purchase adds a reserve breach on ${incrementalReserveBreachDate}.`);
  return {
    analyzedAt: new Date().toISOString(), asOfDate: context.asOfDate, forecastEndDate: endDate,
    paymentDueDate: request.paymentDueDate, amountPaise,
    baseline: baselineRisk, withPurchase: proposedRisk,
    incrementalReserveBreachDate, reservePaise: context.minimumReservePaise,
    cashImpactPaise: Math.max(0, baselineRisk.worstCashPaise - proposedRisk.worstCashPaise),
    safeToSchedule: dateInHorizon && proposed.daily.every(day => day.closingCashPaise >= context.minimumReservePaise),
    worsensWorstCash, activeCommitmentCount: existing.length, warnings,
  };
}
