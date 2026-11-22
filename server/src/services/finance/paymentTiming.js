const dayMs = 86400000;
const normalizeCounterparty = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const daysBetween = (later, earlier) => Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / dayMs);
const quantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
};
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);

export function paymentTimingSuggestion(item, historyItems, minimumSamples = 3, asOfDate = null) {
  const key = normalizeCounterparty(item?.counterparty);
  const observations = historyItems.filter(other => String(other._id) !== String(item?._id)
    && other.category === 'receivable' && other.status === 'paid' && normalizeCounterparty(other.counterparty) === key)
    .flatMap(other => (other.settlementEvents || []).filter(event => event.verified === true && event.direction === 'receipt'
      && event.completedInvoice === true && event.dueDate && event.date)
      .map(event => ({ dueDate: event.dueDate, clearedDate: event.date, latenessDays: daysBetween(event.date, event.dueDate) })))
    .sort((a, b) => a.clearedDate.localeCompare(b.clearedDate));
  if (observations.length < minimumSamples) return { available: false, reason: `Need ${minimumSamples} fully settled, verified invoices for this customer; found ${observations.length}. Your current expected date is unchanged.`,
    evidenceCount: observations.length };
  const lateness = observations.map(value => value.latenessDays);
  const medianDaysLate = quantile(lateness, 0.5);
  const p25DaysLate = quantile(lateness, 0.25);
  const p75DaysLate = quantile(lateness, 0.75);
  const spreadDays = p75DaysLate - p25DaysLate;
  const confidence = observations.length >= 10 && spreadDays <= 14 ? 'high'
    : observations.length >= 5 && spreadDays <= 30 ? 'medium' : 'low';
  const historicalDate = addDays(item.dueDate, medianDaysLate);
  const forecastFloor = asOfDate ? addDays(asOfDate, 1) : null;
  const expectedDate = forecastFloor && historicalDate <= asOfDate ? forecastFloor : historicalDate;
  return { available: true, expectedDate, historicalDate, ownerExpectedDate: item.expectedDate || null,
    medianDaysLate, rangeDaysLate: { low: p25DaysLate, high: p75DaysLate }, confidence, evidenceCount: observations.length,
    evidenceWindow: { from: observations[0].clearedDate, through: observations.at(-1).clearedDate },
    evidence: observations.slice(-10).map(({ dueDate, clearedDate, latenessDays }) => ({ dueDate, clearedDate, latenessDays })),
    explanation: `Same-business history for ${item.counterparty}: median payment was ${medianDaysLate} day(s) ${medianDaysLate < 0 ? 'before' : 'after'} due date across ${observations.length} verified invoices.${expectedDate !== historicalDate ? ` That date is before the cash snapshot, so the forecast suggestion is ${expectedDate}.` : ''}` };
}
