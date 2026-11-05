import { createHash } from 'node:crypto';
import { normalizeContext } from '../rescue/validation.js';

const VERSION = 2;
const sort = values => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function savedOrderTerms(scenario) {
  return { label: scenario.label, orderValuePaise: scenario.orderValuePaise, advancePaise: scenario.advancePaise,
    advanceDate: scenario.advanceDate, finalCollectionDate: scenario.finalCollectionDate,
    costLines: (scenario.costLines || []).map(line => ({ description: line.description, amountPaise: line.amountPaise, paymentDate: line.paymentDate })),
    delayedCollectionDays: scenario.delayedCollectionDays ?? 0 };
}
export function analysisFingerprint(rawContext, scenario) {
  const context = normalizeContext(rawContext);
  // Select forecast inputs explicitly: timestamps, audit notes and row order do not
  // affect the calculation. Amounts, dates, verification and actual receipts do.
  const snapshot = { version: VERSION, asOfDate: context.asOfDate, horizonDays: context.horizonDays,
    openingCashPaise: context.openingCashPaise, minimumReservePaise: context.minimumReservePaise,
    bankReviewIssues: sort((context.bankReviewIssues || []).map(i => ({ id: i.transactionId, kind: i.kind, amountPaise: i.amountPaise }))),
    cashItems: sort(context.cashItems.map(item => ({ id: item.id, category: item.category, status: item.status,
      amountPaise: item.amountPaise, settledPaise: item.settledPaise, expectedDate: item.expectedDate || null,
      dueDate: item.dueDate || null, counterparty: item.counterparty || '', externalId: item.externalId || '',
      confidenceState: item.confidenceState || 'owner_assumption',
      receipts: sort((item.gatewayReceipts || []).map(r => ({ id: r.paymentOfferId, amountPaise: r.amountPaise, date: r.date }))),
      promises: sort((item.paymentPromises || []).map(p => ({ id: String(p._id || p.id), amountPaise: p.amountPaise,
        receivedPaise: p.receivedPaise || 0, promisedDate: p.promisedDate, closedAs: p.closedAs || null }))),
    }))),
    recurringRules: sort(context.recurringRules.map(r => ({ id: String(r.id || r._id || ''), amountPaise: r.amountPaise,
      dayOfMonth: r.dayOfMonth, startsOn: r.startsOn, endsOn: r.endsOn || null, active: r.active !== false }))),
    order: savedOrderTerms(scenario) };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
export function analysisContext(context, scenario) {
  return { version: VERSION, fingerprint: analysisFingerprint(context, scenario), asOfDate: context.asOfDate,
    minimumReservePaise: context.minimumReservePaise ?? 0, horizonDays: context.horizonDays ?? 90 };
}
export function scenarioFreshness(context, scenario) {
  const stale = !scenario.analysisContext?.fingerprint || scenario.analysisContext.fingerprint !== analysisFingerprint(context, scenario);
  const datesExpired = scenario.advanceDate <= context.asOfDate || scenario.costLines.some(line => line.paymentDate <= context.asOfDate);
  return { stale: stale || datesExpired, reason: datesExpired ? 'order_dates_expired' : !scenario.analysisContext?.fingerprint ? 'legacy_analysis' : stale ? 'inputs_changed' : 'current',
    message: datesExpired ? 'Order dates no longer follow the cash snapshot. Edit the order dates before recalculating.'
      : !scenario.analysisContext?.fingerprint ? 'This older analysis has no input snapshot. Recalculate before using its saved advance.'
        : stale ? 'Cash records, payment promises, recurring payments or cash settings changed. Recalculate the saved advance.'
          : 'Calculated against the current recorded cash inputs. Results remain conditional on the entered dates and data.',
    evaluatedAsOfDate: context.asOfDate, datesExpired };
}
