import { createHmac } from 'node:crypto';

export const pseudonym = value => createHmac('sha256', process.env.TELEMETRY_HMAC_KEY).update(value).digest('hex');
export const calendarDays = (later, earlier) => (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000;
export function reliability(observations) {
  const suppliers = new Set(observations.map(row => row.supplierHash));
  if (suppliers.size < 5) return null;
  const median = values => { const sorted = values.sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]; };
  const clearanceDays = median(observations.map(row => calendarDays(row.clearedDate, row.invoiceDate)));
  const latenessDays = median(observations.map(row => Math.max(0, calendarDays(row.clearedDate, row.dueDate))));
  return { clearanceDays, latenessDays, score: Math.max(0, 100 - 2 * latenessDays), invoiceCount: observations.length,
    supplierCount: suppliers.size, windowStart: observations.map(row => row.clearedDate).sort()[0],
    windowEnd: observations.map(row => row.clearedDate).sort().at(-1) };
}
