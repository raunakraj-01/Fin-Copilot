import { z } from 'zod';
import { addDays, horizonEnd, validDate } from './dates.js';

export class DecisionValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'DecisionValidationError';
    this.details = [{ field }];
  }
}
export const fail = (message, field) => { throw new DecisionValidationError(message, field); };
export const isMoney = value => Number.isSafeInteger(value) && value >= 0;
export function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`, field);
}
export function money(value, field, { signed = false } = {}) {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) fail(`${field} must be ${signed ? 'a safe' : 'a nonnegative safe'} integer in paise`, field);
  return value;
}
export function date(value, field) {
  if (!validDate(value)) fail(`${field} must be a valid YYYY-MM-DD date`, field);
  return value;
}
export function boundedInteger(value, field, low, high) {
  if (!Number.isInteger(value) || value < low || value > high) fail(`${field} must be an integer from ${low} to ${high}`, field);
  return value;
}
export function safeTotal(values, field) {
  values.forEach(value => money(value, field));
  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${field} exceeds safe integer arithmetic`, field);
}
export function parseRequest(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  const error = new DecisionValidationError(first.message, first.path.join('.') || 'request');
  error.details = result.error.issues.map(issue => ({ field: issue.path.join('.') || 'request', message: issue.message }));
  throw error;
}
const rescueOptionsSchema = z.object({
  objective: z.enum(['nonnegative', 'minimum_reserve']).default('nonnegative'),
  maxCandidates: z.number().int().min(1).max(12).default(12),
  maxPlans: z.number().int().min(1).max(3).default(3),
});
export function validateRescueOptions(value = {}) {
  return parseRequest(rescueOptionsSchema, value);
}

const constraintKeys = ['mandatory', 'negotiable', 'discretionary', 'maxExtensionDays', 'earliestCollectionDate', 'maxEarlyCollectionPaise', 'estimatedActionCostPaise', 'actionCostDate'];
export function normalizeContext(value) {
  object(value, 'context');
  const asOfDate = date(value.asOfDate, 'asOfDate');
  const horizonDays = boundedInteger(value.horizonDays ?? 90, 'horizonDays', 1, 366);
  horizonEnd(asOfDate, horizonDays);
  const openingCashPaise = money(value.openingCashPaise, 'openingCashPaise', { signed: true });
  const minimumReservePaise = money(value.minimumReservePaise ?? 0, 'minimumReservePaise');
  const items = value.cashItems ?? [];
  const rules = value.recurringRules ?? [];
  if (!Array.isArray(items) || !Array.isArray(rules)) fail('Cash items and recurring rules must be arrays', 'context');
  const seen = new Set();
  const cashItems = items.map((item, index) => {
    const field = `cashItems[${index}]`;
    object(item, field);
    const id = String(item.id ?? item._id ?? '');
    if (!id || seen.has(id)) fail('Cash items must have distinct source IDs', `${field}.id`);
    seen.add(id);
    if (!['receivable', 'payable', 'expense'].includes(item.category)) fail('Invalid cash item category', `${field}.category`);
    if (!['open', 'partial', 'paid', 'cancelled'].includes(item.status)) fail('Invalid cash item status', `${field}.status`);
    money(item.amountPaise, `${field}.amountPaise`);
    const settledPaise = money(item.settledPaise ?? 0, `${field}.settledPaise`);
    if (settledPaise > item.amountPaise) fail('Settlement exceeds the item amount', `${field}.settledPaise`);
    if (item.expectedDate) date(item.expectedDate, `${field}.expectedDate`);
    const normalized = { ...item, id, ...(item._id ? { _id: String(item._id) } : {}), settledPaise };
    for (const key of constraintKeys) {
      const constraint = item[key] !== undefined ? item[key] : item.constraints?.[key];
      if (constraint !== undefined) normalized[key] = constraint;
    }
    for (const key of ['mandatory', 'negotiable', 'discretionary']) {
      if (normalized[key] !== undefined && typeof normalized[key] !== 'boolean') fail(`${key} must be boolean`, `${field}.${key}`);
    }
    for (const key of ['maxEarlyCollectionPaise', 'estimatedActionCostPaise']) {
      if (normalized[key] != null) money(normalized[key], `${field}.${key}`);
    }
    if (normalized.maxExtensionDays != null) boundedInteger(normalized.maxExtensionDays, `${field}.maxExtensionDays`, 0, 3660);
    if (normalized.earliestCollectionDate) date(normalized.earliestCollectionDate, `${field}.earliestCollectionDate`);
    if (normalized.actionCostDate) date(normalized.actionCostDate, `${field}.actionCostDate`);
    return normalized;
  });
  const recurringRules = rules.map((rule, index) => {
    object(rule, `recurringRules[${index}]`);
    money(rule.amountPaise, `recurringRules[${index}].amountPaise`);
    return { ...rule };
  });
  // Conservative bound also covers recurring occurrences and signed opening cash.
  safeTotal([Math.abs(openingCashPaise), minimumReservePaise, ...cashItems.map(item => item.amountPaise), ...cashItems.map(item => item.estimatedActionCostPaise ?? 0), ...recurringRules.map(rule => rule.amountPaise * Math.ceil(horizonDays / 28))], 'forecast amounts');
  return { asOfDate, horizonDays, openingCashPaise, minimumReservePaise, cashItems, recurringRules };
}

export function runForecast(buildForecast, context, overrides = {}) {
  if (typeof buildForecast !== 'function') throw new Error('Shared buildForecast dependency is missing');
  const input = { ...context, additionalEvents: [], ...overrides };
  const result = buildForecast(structuredClone(input));
  if (!result || !Array.isArray(result.daily) || result.daily.length !== context.horizonDays) throw new Error('Shared forecast returned an incomplete daily timeline');
  result.daily.forEach((day, index) => {
    if (day.date !== addDays(context.asOfDate, index) || !Number.isSafeInteger(day.closingCashPaise)) throw new Error('Shared forecast returned invalid daily data');
  });
  return result;
}

export function summarize(forecast, reserve = 0) {
  const daily = forecast.daily;
  const worst = daily.reduce((lowest, day) => day.closingCashPaise < lowest.closingCashPaise ? day : lowest);
  return {
    worstCashPaise: worst.closingCashPaise, worstDate: worst.date,
    firstNegativeDate: daily.find(day => day.closingCashPaise < 0)?.date ?? null,
    firstReserveBreachDate: daily.find(day => day.closingCashPaise < reserve)?.date ?? null,
    daily,
  };
}
