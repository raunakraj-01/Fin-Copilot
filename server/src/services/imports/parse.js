import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/node';
import { fail } from '../../utils/http.js';

export async function parseUpload(file) {
  const type = file.originalname.toLowerCase().endsWith('.csv') ? 'csv' : file.originalname.toLowerCase().endsWith('.xlsx') ? 'xlsx' : null;
  if (!type) fail(400, 'VALIDATION_ERROR', 'Upload a CSV or XLSX file');
  let rows;
  if (type === 'csv') {
    const parsed = Papa.parse(file.buffer.toString('utf8').replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
    if (parsed.errors.length) fail(400, 'VALIDATION_ERROR', `CSV parse error: ${parsed.errors[0].message}`);
    rows = parsed.data;
  } else {
    try { rows = await readSheet(file.buffer); }
    catch { fail(400, 'VALIDATION_ERROR', 'Invalid XLSX file'); }
    rows = rows.filter(row => row.some(value => value != null && value !== '')).map(row => row.map(value => {
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      if (typeof value === 'object' && value !== null) return String(value.text ?? value.result ?? '');
      return String(value ?? '');
    }));
  }
  if (rows.length < 2) fail(400, 'VALIDATION_ERROR', 'File needs a header and at least one data row');
  if (rows.length > 501) fail(400, 'VALIDATION_ERROR', 'Maximum 500 data rows per file');
  const headers = rows[0].map(value => String(value).trim());
  if (headers.some(value => !value) || new Set(headers).size !== headers.length) fail(400, 'VALIDATION_ERROR', 'Headers must be unique and non-empty');
  return { type, headers, rawRows: rows.slice(1).map((row, index) => ({ rowNumber: index + 2,
    values: Object.fromEntries(headers.map((header, i) => [header, String(row[i] ?? '').trim()])) })) };
}

const aliases = {
  externalId: ['invoice id', 'bill id', 'external id'], counterparty: ['customer', 'supplier', 'counterparty'],
  amountInr: ['amount inr', 'amount'], settledInr: ['settled inr', 'settled'],
  dueDate: ['due date'], expectedDate: ['expected date'], status: ['status'],
  mandatory: ['mandatory'], negotiable: ['negotiable'], discretionary: ['discretionary'],
  maxExtensionDays: ['max extension days'], earliestCollectionDate: ['earliest collection date'],
  maxEarlyCollectionInr: ['max early collection inr'], estimatedActionCostInr: ['estimated action cost inr'],
};

export function suggestMapping(headers) {
  return Object.fromEntries(Object.entries(aliases).flatMap(([field, names]) => {
    const header = headers.find(value => names.includes(value.trim().toLowerCase()));
    return header ? [[field, header]] : [];
  }));
}
