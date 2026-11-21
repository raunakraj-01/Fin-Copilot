import { todayIndia } from '../../utils/dates.js';

const DAY_MS = 86_400_000;
export const indiaDate = todayIndia;

const dateValue = value => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.valueOf()) ? date : null;
};

function daysBetween(later, earlier) {
  return Math.floor((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS);
}

export function cashDeskSummary(context, forecast, now = new Date()) {
  const today = todayIndia(now);
  const updatedAt = dateValue(context.latestInputAt);
  const lastUpdatedAt = updatedAt ? updatedAt.toISOString() : null;
  const lastUpdatedDate = lastUpdatedAt ? lastUpdatedAt.slice(0, 10) : context.asOfDate;
  const staleDays = Math.max(0, daysBetween(today, lastUpdatedDate));
  const next30Days = forecast.daily.slice(0, 30);
  const lowestCashNext30Days = next30Days.length
    ? Math.min(...next30Days.map(day => day.closingCashPaise))
    : forecast.openingCashPaise;
  const bankIssues = context.bankReviewIssues || [];
  const openItems = context.cashItems.filter(item => ['open', 'partial'].includes(item.status));
  const cashItemIssues = openItems.filter(item => item.confidenceState === 'needs_review'
    || !item.expectedDate || item.expectedDate <= context.asOfDate);

  return {
    snapshotDate: context.asOfDate,
    safeToSpendPaise: Math.max(0, lowestCashNext30Days - context.minimumReservePaise),
    dataFreshness: {
      lastUpdatedAt,
      staleDays,
      stale: staleDays > 7,
      lastSuccessfulSyncAt: context.lastSuccessfulSyncAt || null,
      lastImportAt: context.lastImportAt || null,
    },
    unresolvedIssues: {
      totalCount: bankIssues.length + cashItemIssues.length,
      bankRows: bankIssues,
      cashItems: cashItemIssues.map(item => ({
        cashItemId: String(item.id || item._id),
        externalId: item.externalId || '',
        counterparty: item.counterparty || '',
        amountPaise: Math.max(0, item.amountPaise - (item.settledPaise || 0)),
        reason: item.confidenceState === 'needs_review' ? 'verification' : 'expected_date',
      })),
    },
  };
}
