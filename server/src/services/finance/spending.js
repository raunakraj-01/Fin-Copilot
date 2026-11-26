import { buildForecast } from './forecast.js';
import { currentPromises } from './promises.js';
import { addDays } from '../rescue/dates.js';
import { normalizeContext, DecisionValidationError } from '../rescue/validation.js';

const daysBetween = (a, b) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
export const businessToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function integer(value) {
  if (!Number.isSafeInteger(value)) throw new DecisionValidationError('Spending calculation exceeds safe integer arithmetic', 'amountPaise');
  return value;
}

export function spendingCheck(rawContext, { delayDays = 7, spendPaise = 0, commitmentsConfirmed = false, today = businessToday() } = {}) {
  const context = normalizeContext(rawContext);
  if (![7, 15, 30].includes(delayDays) || !Number.isSafeInteger(spendPaise) || spendPaise < 0)
    throw new DecisionValidationError('Invalid delay or proposed spending amount', 'spendPaise');
  const issues = [];
  const issue = (code, message, blocking, amountPaise = 0, itemId = null, meta = null) =>
    issues.push({ code, message, blocking, amountPaise, itemId, ...(meta || {}) });
  for (const bank of context.bankReviewIssues || []) {
    issue('BANK_REVIEW', bank.message, true, bank.amountPaise, bank.transactionId, { reasonCode: 'bank_review' });
  }
  const ageDays = daysBetween(today, context.asOfDate);
  if (ageDays > 0) issue('STALE_CASH', `Cash snapshot is ${ageDays} days old. Update the as-of date and bank cash in Setup & Import.`, true, 0, null, { reasonCode: 'stale_cash' });
  if (ageDays < 0) issue('FUTURE_CASH', 'Cash snapshot is dated in the future. Use a current cash snapshot for a spending decision.', true, 0, null, { reasonCode: 'future_cash' });
  if (!commitmentsConfirmed) issue('CONFIRM_COMMITMENTS', 'Confirm that wages, tax payments, supplier bills, loan payments and other commitments are included for this horizon.', true, 0, null, { reasonCode: 'confirm_commitments' });
  let excludedReceiptsPaise = 0;
  let excludedPaymentsPaise = 0;
  let overduePromisesPaise = 0;
  for (const item of context.cashItems) {
    if (!['open', 'partial'].includes(item.status)) continue;
    let remaining = item.amountPaise - item.settledPaise;
    if (!remaining) continue;
    const receipt = item.category === 'receivable';
    const label = item.externalId || item.counterparty || item.id;
    const itemMeta = {
      category: item.category,
      counterparty: item.counterparty || label,
      externalId: item.externalId || null,
      totalAmountPaise: item.amountPaise,
      settledPaise: item.settledPaise,
      dueDate: item.dueDate || null,
      expectedDate: item.expectedDate || null,
    };
    let reason;
    let reasonCode = null;
    if (item.confidenceState === 'needs_review') {
      reason = 'needs verification';
      reasonCode = 'needs_review';
    } else {
      if (receipt) {
        for (const p of currentPromises(item, context.asOfDate)) {
          remaining -= p.forecastPaise;
          if (p.promisedDate <= context.asOfDate) overduePromisesPaise = integer(overduePromisesPaise + p.forecastPaise);
          if (p.status === 'review_external_settlement') {
            issue('PROMISE_ALLOCATION', `${label}: a payment recorded elsewhere needs promise review.`, true, p.forecastPaise, item.id, { ...itemMeta, reasonCode: 'promise_allocation' });
          }
        }
      }
      if (!remaining) continue;
      if (!item.expectedDate) {
        reason = 'has no expected payment date';
        reasonCode = 'missing_date';
      } else if (item.expectedDate <= context.asOfDate) {
        reason = 'has an overdue or snapshot-day amount without a future payment date';
        reasonCode = 'overdue';
      }
    }
    if (!reason) continue;
    if (receipt) excludedReceiptsPaise = integer(excludedReceiptsPaise + remaining);
    else excludedPaymentsPaise = integer(excludedPaymentsPaise + remaining);
    issue(receipt ? 'EXCLUDED_RECEIPT' : 'EXCLUDED_PAYMENT', `${label}: ${reason}. This amount is excluded from the forecast.`, true, remaining, item.id, { ...itemMeta, reasonCode });
  }
  if (overduePromisesPaise) issue('OVERDUE_PROMISES', 'Due or broken promise amounts are excluded until new future dates are agreed; neither scenario assumes recovery.', false, overduePromisesPaise, null, { reasonCode: 'overdue_promises' });
  const expectedForecast = buildForecast(context);
  // Delay only money still expected from customers. Actual dated receipts and all
  // outgoing commitments keep their dates; broken promises are never resurrected.
  const delayedItems = context.cashItems.map(item => item.category === 'receivable' && ['open', 'partial'].includes(item.status)
    ? { ...item, expectedDate: item.expectedDate > context.asOfDate ? addDays(item.expectedDate, delayDays) : item.expectedDate,
      paymentPromises: (item.paymentPromises || []).map(p => !p.closedAs && p.promisedDate > context.asOfDate
        ? { ...p, promisedDate: addDays(p.promisedDate, delayDays) } : { ...p }) } : item);
  const delayedForecast = buildForecast({ ...context, cashItems: delayedItems });
  const complete = !issues.some(i => i.blocking);
  const summarize = forecast => {
    const minimum = forecast.daily.reduce((low, day) => day.closingCashPaise < low.closingCashPaise ? day : low);
    const margin = integer(minimum.closingCashPaise - context.minimumReservePaise);
    const afterSpendMinimumPaise = integer(minimum.closingCashPaise - spendPaise);
    const firstBreachAfterSpend = forecast.daily.find(day => integer(day.closingCashPaise - spendPaise) < context.minimumReservePaise)?.date || null;
    return { spendablePaise: complete ? Math.max(0, margin) : null,
      minimumBalancePaise: minimum.closingCashPaise, minimumDate: minimum.date,
      reserveGapPaise: Math.max(0, -margin), firstReserveBreachDate: forecast.risk.firstReserveBreachDate,
      canSpend: complete ? margin >= spendPaise : null, afterSpendMinimumPaise,
      firstBreachAfterSpend, includedReceiptsPaise: integer(forecast.daily.reduce((sum, day) => sum + day.receiptsPaise, 0)),
      includedPaymentsPaise: integer(forecast.daily.reduce((sum, day) => sum + day.paymentsPaise, 0)) };
  };
  const expected = summarize(expectedForecast);
  const delayed = summarize(delayedForecast);
  return { status: complete ? 'conditional' : 'incomplete', asOfDate: context.asOfDate, evaluatedOn: today,
    horizonDays: context.horizonDays, endDate: expectedForecast.daily.at(-1).date, delayDays, spendPaise,
    openingCashPaise: context.openingCashPaise, minimumReservePaise: context.minimumReservePaise,
    expected, delayed, recommendedSpendablePaise: complete ? Math.min(expected.spendablePaise, delayed.spendablePaise) : null,
    dataQuality: { complete, snapshotAgeDays: ageDays, commitmentsConfirmed, excludedReceiptsPaise, excludedPaymentsPaise, overduePromisesPaise, issues },
    assumptions: ['The limit is an additional cash outflow today, using the lowest daily closing balance including the snapshot day, less the reserve.',
      `All future unconfirmed customer receipts, including installments, are delayed by ${delayDays} calendar days in the delayed scenario. This is a stress test, not a prediction.`,
      'Actual dated receipts are not delayed. Receipts shifted beyond the horizon do not fund spending within it.',
      'Limits depend on entered balances, commitments and dates. They do not establish intraday liquidity or affordability after the selected horizon.'] };
}
