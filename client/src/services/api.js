export const baseUrl = (import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api')).replace(/\/$/, '');
import { readJsonSafe, sessionFetch } from './session.js';

export async function api(path, options) {
  const response = await sessionFetch(`${baseUrl}${path}`, options);
  const data = await readJsonSafe(response);
  if (!response.ok) {
    const labels = { status: 'Status', expectedDate: 'Expected cash date', dueDate: 'Due date',
      amountPaise: 'Amount', settledPaise: 'Already settled', counterparty: 'Counterparty',
      'constraints.maxEarlyCollectionPaise': 'Max early collection', 'constraints.maxExtensionDays': 'Max extension days' };
    const details = data?.error?.details?.map(issue => `${labels[issue.field] || issue.field}: ${issue.message}`).join('; ');
    const error = new Error(details || data?.error?.message || `Request failed (${response.status})`);
    error.status = response.status; error.code = data?.error?.code;
    throw error;
  }
  return data;
}

export function json(path, method, body) {
  return api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
