import { isDateOnly } from '../../utils/dates.js';
import { parseInrPaise } from '../../utils/money.js';
import { canonicalId, digest } from './identity.js';

export const bankFields = ['transactionId', 'date', 'description', 'creditInr', 'debitInr'];
const aliases = { transactionId: ['transaction id', 'reference', 'reference no', 'utr', 'transactionid'], date: ['date', 'transaction date', 'value date'],
  description: ['description', 'narration', 'particulars'], creditInr: ['credit', 'credit inr', 'deposit', 'deposits'], debitInr: ['debit', 'debit inr', 'withdrawal', 'withdrawals'] };
export const bankMapping = headers => Object.fromEntries(bankFields.flatMap(field => {
  const found = headers.find(h => aliases[field].includes(h.trim().toLowerCase())); return found ? [[field, found]] : [];
}));
export function normalizeBankRows(rows, mapping, accountKey, corrections = [], excluded = []) {
  const seen = new Set();
  return rows.filter(row => !excluded.includes(row.rowNumber)).map(row => {
    const overrides = corrections.find(c => c.rowNumber === row.rowNumber)?.values || {};
    const get = field => String(overrides[field] ?? row.values[mapping[field]] ?? '').trim();
    const issues = [];
    const transactionId = canonicalId(get('transactionId'));
    const date = get('date');
    if (!transactionId || transactionId.length > 200) issues.push('Supply a stable bank transaction ID/reference (maximum 200 characters).');
    if (seen.has(transactionId)) issues.push('Repeated transaction ID in this file. Exclude the duplicate or correct its reference.');
    seen.add(transactionId);
    if (!isDateOnly(date)) issues.push('Use a valid YYYY-MM-DD transaction date.');
    let creditPaise = 0, debitPaise = 0;
    try { creditPaise = parseInrPaise(get('creditInr') || '0'); debitPaise = parseInrPaise(get('debitInr') || '0');
      if (creditPaise < 0 || debitPaise < 0 || (creditPaise > 0) === (debitPaise > 0)) throw new Error();
    } catch { issues.push('Enter one positive credit or debit, with at most two decimal places.'); }
    const description = get('description');
    if (description.length > 1000) issues.push('Description must be at most 1000 characters.');
    return { rowNumber: row.rowNumber, state: issues.length ? 'needsReview' : 'accepted', issues,
      item: { accountKey, transactionId, date, description, creditPaise, debitPaise, identity: digest([accountKey, transactionId]) } };
  });
}
export const reservedPaise = transaction => transaction.allocations.filter(a => (a.direction || 'credit') === 'credit' && a.status !== 'rejected').reduce((sum, a) => sum + a.amountPaise, 0);
export const availablePaise = transaction => Math.max(0, transaction.creditPaise - reservedPaise(transaction));
export const availableDebitPaise = transaction => Math.max(0, transaction.debitPaise - transaction.allocations.filter(a => a.direction === 'debit' && a.status !== 'rejected').reduce((sum, a) => sum + a.amountPaise, 0));
export function matchingSuggestions(transaction, invoices) {
  const narration = canonicalId(transaction.description);
  return invoices.map(item => {
    let score = 0; const reasons = [];
    const id = canonicalId(item.externalId);
    if (id.length >= 3 && narration.includes(id)) { score += 100; reasons.push('Invoice reference appears in bank description'); }
    if (item.amountPaise - item.settledPaise === availablePaise(transaction)) { score += 40; reasons.push('Amount equals outstanding balance'); }
    const party = canonicalId(item.counterparty);
    if (party.length >= 3 && narration.includes(party)) { score += 20; reasons.push('Customer name appears in bank description'); }
    return { cashItemId: String(item._id), score, reasons };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.cashItemId.localeCompare(b.cashItemId)).slice(0, 5);
}
