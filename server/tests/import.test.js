import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseUpload, suggestMapping } from '../src/services/imports/parse.js';
import { normalizeRows } from '../src/services/imports/normalize.js';
import { parseInrPaise } from '../src/utils/money.js';
import { isDateOnly } from '../src/utils/dates.js';

describe('fixture import', () => {
  it('maps the supplied CSVs into valid integer-paise items', async () => {
    for (const [name, kind, count] of [['receivables.csv', 'receivables', 2], ['payables.csv', 'payables', 3]]) {
      const buffer = await readFile(new URL(`../../fixtures/${name}`, import.meta.url));
      const parsed = await parseUpload({ originalname: name, buffer });
      const rows = normalizeRows(parsed.rawRows, suggestMapping(parsed.headers), kind, 'csv');
      expect(rows).toHaveLength(count);
      expect(rows.every(row => row.state === 'accepted')).toBe(true);
      expect(rows[0].item.amountPaise).toBe(kind === 'receivables' ? 40_000_000 : 30_000_000);
    }
  });

  it('rejects impossible dates and settlement above face value', () => {
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(parseInrPaise('₹1,20,000')).toBe(12_000_000);
    const rows = normalizeRows([{ rowNumber: 2, values: { ID: 'A', Party: 'Customer', Amount: '100', Settled: '101', Due: '2026-02-30', Expected: '' } }],
      { externalId: 'ID', counterparty: 'Party', amountInr: 'Amount', settledInr: 'Settled', dueDate: 'Due', expectedDate: 'Expected' }, 'receivables', 'csv');
    expect(rows[0].state).toBe('rejected');
    expect(rows[0].issues.map(issue => issue.code)).toContain('INVALID_BALANCE');
    expect(rows[0].issues.map(issue => issue.code)).toContain('INVALID_DATE');
  });

  it('reads an XLSX sheet with the same mapping path', async () => {
    const buffer = await readFile(new URL('./fixtures/receivables.xlsx', import.meta.url));
    const parsed = await parseUpload({ originalname: 'test.xlsx', buffer });
    const rows = normalizeRows(parsed.rawRows, suggestMapping(parsed.headers), 'receivables', 'excel');
    expect(parsed.type).toBe('xlsx');
    expect(rows[0].state).toBe('accepted');
    expect(rows[0].item.amountPaise).toBe(12_000_000);
  });
});
