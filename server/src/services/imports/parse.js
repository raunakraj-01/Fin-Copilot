import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/node';
import { fail } from '../../utils/http.js';
import { validateLedgerMeta } from '../../middleware/upload.js';

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function hasXlsxMagic(buffer) {
  return buffer.length >= 4 && XLSX_MAGIC.every((byte, i) => buffer[i] === byte);
}

function decodeStrictCsvText(buffer) {
  if (buffer.includes(0x00)) {
    fail(400, 'VALIDATION_ERROR', 'CSV file contains binary null bytes');
  }
  let text;
  try {
    text = utf8Decoder.decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    fail(400, 'VALIDATION_ERROR', 'CSV file must contain valid UTF-8 text');
  }
  const trimmed = text.trimStart().toLowerCase();
  if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html') || trimmed.startsWith('<script') || trimmed.startsWith('%pdf-')) {
    fail(400, 'VALIDATION_ERROR', 'Invalid CSV file content');
  }
  return text;
}

function parseJsonRows(buffer) {
  if (buffer.includes(0x00)) {
    fail(400, 'VALIDATION_ERROR', 'JSON file contains binary null bytes');
  }
  let text;
  try {
    text = utf8Decoder.decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    fail(400, 'VALIDATION_ERROR', 'JSON file must contain valid UTF-8 text');
  }
  let payload;
  try { payload = JSON.parse(text); }
  catch { fail(400, 'VALIDATION_ERROR', 'Invalid JSON file'); }
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? (payload.rows || payload.cashItems || payload.items || payload.records || payload.data)
      : null;
  if (!Array.isArray(records) || records.length === 0) {
    fail(400, 'VALIDATION_ERROR', 'JSON file must contain a non-empty array of records');
  }
  if (records.length > 500) fail(400, 'VALIDATION_ERROR', 'Maximum 500 data rows per file');
  if (records.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    fail(400, 'VALIDATION_ERROR', 'Each JSON record must be an object');
  }
  const headers = [...new Set(records.flatMap(item => Object.keys(item).map(key => String(key).trim())))];
  if (!headers.length || headers.some(value => !value)) {
    fail(400, 'VALIDATION_ERROR', 'Headers must be unique and non-empty');
  }
  return {
    type: 'json',
    headers,
    rawRows: records.map((item, index) => ({
      rowNumber: index + 2,
      values: Object.fromEntries(headers.map(header => {
        const value = item[header];
        return [header, value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value).trim()];
      })),
    })),
  };
}

export async function parseUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    fail(400, 'VALIDATION_ERROR', 'Uploaded file is empty');
  }
  const type = validateLedgerMeta(file);
  if (type === 'json') return parseJsonRows(file.buffer);
  let rows;
  if (type === 'csv') {
    const csvText = decodeStrictCsvText(file.buffer);
    const parsed = Papa.parse(csvText, { skipEmptyLines: 'greedy' });
    if (parsed.errors.length) fail(400, 'VALIDATION_ERROR', `CSV parse error: ${parsed.errors[0].message}`);
    rows = parsed.data;
  } else {
    if (!hasXlsxMagic(file.buffer)) {
      fail(400, 'VALIDATION_ERROR', 'Invalid XLSX file signature');
    }
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
  externalId: ['invoice id', 'bill id', 'external id', 'externalid', 'invoiceid'],
  counterparty: ['customer', 'supplier', 'counterparty', 'party'],
  amountInr: ['amount inr', 'amount', 'amountinr'],
  settledInr: ['settled inr', 'settled', 'settledinr'],
  dueDate: ['due date', 'duedate'],
  expectedDate: ['expected date', 'expecteddate'],
  status: ['status'],
  mandatory: ['mandatory'],
  negotiable: ['negotiable'],
  discretionary: ['discretionary'],
  maxExtensionDays: ['max extension days', 'maxextensiondays'],
  earliestCollectionDate: ['earliest collection date', 'earliestcollectiondate'],
  maxEarlyCollectionInr: ['max early collection inr', 'maxearlycollectioninr'],
  estimatedActionCostInr: ['estimated action cost inr', 'estimatedactioncostinr'],
  actionCostDate: ['action cost date', 'fee payment date', 'actioncostdate'],
};

export function suggestMapping(headers) {
  return Object.fromEntries(Object.entries(aliases).flatMap(([field, names]) => {
    const header = headers.find(value => names.includes(value.trim().toLowerCase()));
    return header ? [[field, header]] : [];
  }));
}
