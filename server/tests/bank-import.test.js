import { expect, it } from 'vitest';
import { bankMapping, normalizeBankRows, matchingSuggestions } from '../src/services/imports/bank.js';
import { normalizeRows } from '../src/services/imports/normalize.js';
import { parseInrPaise } from '../src/utils/money.js';
const headers = ['Transaction ID', 'Date', 'Narration', 'Credit', 'Debit'];
const row = (id = 'utr-1', credit = '10,000.29', debit = '') => ({ rowNumber: 2, values: { 'Transaction ID': id, Date: '2026-11-03', Narration: 'Buyer INV-001', Credit: credit, Debit: debit } });
it('normalizes stable references, mapping and exact INR amounts without guessing dates or IDs', () => {
  const result = normalizeBankRows([row()], bankMapping(headers), 'BUSINESS')[0];
  expect(result.state).toBe('accepted'); expect(result.item.transactionId).toBe('UTR-1'); expect(result.item.creditPaise).toBe(1000029);
  expect(parseInrPaise('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
  expect(parseInrPaise('0.29')).toBe(29);
  expect(() => parseInrPaise('12,34,5')).toThrow();
  expect(() => parseInrPaise('90071992547409.92')).toThrow();
});
it('requires review for invalid, ambiguous, negative and duplicate bank rows', () => {
  for (const input of [row(''), row('id', '100', '10'), row('id', '-1'), row('id', '0'), row('id', '0.001')])
    expect(normalizeBankRows([input], bankMapping(headers), 'A')[0].state).toBe('needsReview');
  const invalid = row(); invalid.values.Date = '03/11/2026';
  expect(normalizeBankRows([invalid], bankMapping(headers), 'A')[0].state).toBe('needsReview');
  expect(normalizeBankRows([row('UTR-1'), { ...row(' utr-1 '), rowNumber: 3 }], bankMapping(headers), 'A')[1].state).toBe('needsReview');
  const corrected = normalizeBankRows([invalid], bankMapping(headers), 'A', [{ rowNumber: 2, values: { date: '2026-11-03' } }]);
  expect(corrected[0].state).toBe('accepted');
});
it('ranks explainable suggestions without changing records', () => {
  const transaction = { creditPaise: 10000, allocations: [], description: 'Buyer INV-001' };
  const invoices = [{ _id: 'exact', externalId: 'INV-001', counterparty: 'Other', amountPaise: 20000, settledPaise: 0 },
    { _id: 'amount', externalId: 'INV-002', counterparty: 'Buyer', amountPaise: 10000, settledPaise: 0 }];
  const original = structuredClone(invoices);
  expect(matchingSuggestions(transaction, invoices)[0]).toMatchObject({ cashItemId: 'exact', score: 100 });
  expect(invoices).toEqual(original);
});
it('detects invoice IDs repeated with different letter case', () => {
  const records = [{ rowNumber: 2, values: { ID: 'Inv-A', Party: 'Buyer', Amount: '100', Date: '2026-11-03' } },
    { rowNumber: 3, values: { ID: ' inv-a ', Party: 'Buyer', Amount: '100', Date: '2026-11-03' } }];
  expect(normalizeRows(records, { externalId: 'ID', counterparty: 'Party', amountInr: 'Amount', dueDate: 'Date', expectedDate: 'Date' }, 'receivables', 'csv')[1].issues.some(i => i.code === 'DUPLICATE_IN_FILE')).toBe(true);
});
