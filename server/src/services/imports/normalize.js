import { isDateOnly } from '../../utils/dates.js';
import { parseInrPaise } from '../../utils/money.js';
import { canonicalId } from './identity.js';

const truthy = value => ['yes', 'true', '1'].includes(String(value).trim().toLowerCase());

export function normalizeRows(rawRows, mapping, kind, sourceSystem) {
  const seen = new Set();
  return rawRows.map(({ rowNumber, values, overrides = {} }) => {
    const get = field => String(overrides[field] ?? values[mapping[field]] ?? '').trim();
    const issues = [];
    const required = field => {
      const value = get(field);
      if (!value) issues.push({ rowNumber, field, code: 'REQUIRED', severity: 'error', message: `${field} is required` });
      return value;
    };
    const externalId = get('externalId');
    if (!externalId) issues.push({ rowNumber, field: 'externalId', code: 'MISSING_ID', severity: 'review', message: 'Source ID needs review' });
    if (externalId) {
      const key = `${kind}:${canonicalId(externalId)}`;
      if (seen.has(key)) issues.push({ rowNumber, field: 'externalId', code: 'DUPLICATE_IN_FILE', severity: 'error', message: 'Repeated source ID in file' });
      seen.add(key);
    }
    let amountPaise;
    let settledPaise;
    try { amountPaise = parseInrPaise(required('amountInr')); } catch { issues.push({ rowNumber, field: 'amountInr', code: 'INVALID_AMOUNT', severity: 'error', message: 'Invalid amount' }); }
    try { settledPaise = parseInrPaise(get('settledInr') || '0'); } catch { issues.push({ rowNumber, field: 'settledInr', code: 'INVALID_AMOUNT', severity: 'error', message: 'Invalid settled amount' }); }
    if (amountPaise <= 0 || settledPaise < 0 || settledPaise > amountPaise) issues.push({ rowNumber, field: 'amountInr', code: 'INVALID_BALANCE', severity: 'error', message: 'Amount must be positive and settlement cannot exceed it' });
    const dueDate = required('dueDate');
    const expectedDate = get('expectedDate');
    if (dueDate && !isDateOnly(dueDate)) issues.push({ rowNumber, field: 'dueDate', code: 'INVALID_DATE', severity: 'error', message: 'Invalid due date' });
    if (expectedDate && !isDateOnly(expectedDate)) issues.push({ rowNumber, field: 'expectedDate', code: 'INVALID_DATE', severity: 'error', message: 'Invalid expected date' });
    const status = get('status').toLowerCase() || 'open';
    if (!['open', 'partial', 'paid', 'cancelled'].includes(status)) issues.push({ rowNumber, field: 'status', code: 'INVALID_STATUS', severity: 'error', message: 'Invalid status' });
    if (status === 'paid' && settledPaise !== amountPaise) issues.push({ rowNumber, field: 'status', code: 'SETTLEMENT_MISMATCH', severity: 'error', message: 'Paid item must be fully settled' });
    if (status === 'open' && settledPaise > 0) issues.push({ rowNumber, field: 'status', code: 'SETTLEMENT_MISMATCH', severity: 'error', message: 'Use partial status for a partly settled item' });
    if (status === 'partial' && !(settledPaise > 0 && settledPaise < amountPaise)) issues.push({ rowNumber, field: 'status', code: 'SETTLEMENT_MISMATCH', severity: 'error', message: 'Partial item needs partial settlement' });
    if (!expectedDate && !['paid', 'cancelled'].includes(status)) issues.push({ rowNumber, field: 'expectedDate', code: 'MISSING_EXPECTED_DATE', severity: 'review', message: 'Expected date must be confirmed before commit' });
    const counterparty = required('counterparty');
    const constraints = {
      mandatory: truthy(get('mandatory')), negotiable: truthy(get('negotiable')),
      discretionary: truthy(get('discretionary')),
      maxExtensionDays: Number(get('maxExtensionDays') || 0),
    };
    if (!Number.isInteger(constraints.maxExtensionDays) || constraints.maxExtensionDays < 0 || constraints.maxExtensionDays > 90) {
      issues.push({ rowNumber, field: 'maxExtensionDays', code: 'INVALID_LIMIT', severity: 'error', message: 'Extension must be 0–90 days' });
    }
    if (get('earliestCollectionDate')) {
      if (!isDateOnly(get('earliestCollectionDate'))) issues.push({ rowNumber, field: 'earliestCollectionDate', code: 'INVALID_DATE', severity: 'error', message: 'Invalid earliest date' });
      else constraints.earliestCollectionDate = get('earliestCollectionDate');
    }
    if (get('actionCostDate')) {
      if (!isDateOnly(get('actionCostDate'))) issues.push({ rowNumber, field: 'actionCostDate', code: 'INVALID_DATE', severity: 'error', message: 'Invalid fee payment date' });
      else constraints.actionCostDate = get('actionCostDate');
    }
    for (const [field, target] of [['maxEarlyCollectionInr', 'maxEarlyCollectionPaise'], ['estimatedActionCostInr', 'estimatedActionCostPaise']]) {
      if (get(field)) {
        try { constraints[target] = parseInrPaise(get(field)); if (constraints[target] < 0) throw new Error(); }
        catch { issues.push({ rowNumber, field, code: 'INVALID_AMOUNT', severity: 'error', message: 'Invalid action amount' }); }
      }
    }
    if (constraints.maxEarlyCollectionPaise > amountPaise - settledPaise) issues.push({ rowNumber, field: 'maxEarlyCollectionInr', code: 'INVALID_LIMIT', severity: 'error', message: 'Early collection cap exceeds outstanding' });
    return { rowNumber, values, item: { category: kind === 'receivables' ? 'receivable' : 'payable',
      externalId: externalId || undefined, counterparty, sourceSystem, amountPaise, settledPaise, status,
      dueDate, expectedDate: expectedDate || undefined, confidenceState: 'owner_assumption', constraints },
      issues, state: issues.some(issue => issue.severity === 'error') ? 'rejected' : issues.length ? 'needsReview' : 'accepted' };
  });
}
