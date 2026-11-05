// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BankReconciliation from '../../client/src/components/BankReconciliation.jsx';
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
const transaction = { id: 'b', transactionId: 'UTR-1', accountKey: 'MAIN', date: '2026-11-03', description: 'Buyer INV-001', creditPaise: 10000, debitPaise: 0,
  availablePaise: 10000, reviewState: 'open', allocations: [], suggestions: [{ cashItemId: 'i', reasons: ['Invoice reference appears in bank description'] }] };
const invoice = { id: 'i', externalId: 'INV-001', counterparty: 'Buyer', outstandingPaise: 20000, promises: [{ id: 'p', remainingPaise: 10000, promisedDate: '2026-11-04' }] };
const listing = (t = transaction) => ({ asOfDate: '2026-11-01', limit: 500, transactions: [t], invoices: [invoice] });
it('requires approval of suggested matches and sends partial amounts with optional promise allocation', async () => {
  const changed = vi.fn();
  const fetch = vi.fn(async (_url, options) => ({ ok: true, status: 200, json: async () => options?.method ? {} : listing() }));
  vi.stubGlobal('fetch', fetch); render(<BankReconciliation workspaceId="w" onChanged={changed} />);
  await screen.findByText(/Suggested matches/);
  expect(fetch.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Use suggestion' }));
  fireEvent.change(screen.getByLabelText('Amount to match (₹)'), { target: { value: '50.29' } });
  fireEvent.change(screen.getByLabelText('Payment promise (optional)'), { target: { value: 'p' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm match' }));
  await screen.findByText('Payment matched. Invoice balance and forecast updated.');
  const [url, options] = fetch.mock.calls.find(([, o]) => o?.method === 'POST');
  expect(url.endsWith('/bank/b/match')).toBe(true);
  expect(JSON.parse(options.body)).toMatchObject({ cashItemId: 'i', amountPaise: 5029, promiseId: 'p', requestId: expect.any(String) });
  expect(changed).toHaveBeenCalled();
});

it('retains a request ID for retry after an uncertain response and can finish a pending match', async () => {
  let failed = false;
  const pending = { ...transaction, availablePaise: 0, allocations: [{ requestId: 'original-request', cashItemId: 'i', amountPaise: 10000, status: 'pending' }] };
  const fetch = vi.fn(async (_url, options) => {
    if (options?.method === 'POST') { if (!failed) { failed = true; throw new Error('Connection interrupted'); } return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => listing(failed ? pending : transaction) };
  });
  vi.stubGlobal('fetch', fetch); render(<BankReconciliation workspaceId="w" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use suggestion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm match' }));
  await screen.findByText('Connection interrupted');
  fireEvent.click(await screen.findByRole('button', { name: 'Finish pending match' }));
  await screen.findByText('Payment matched. Invoice balance and forecast updated.');
  expect(JSON.parse(fetch.mock.calls.filter(([, o]) => o?.method === 'POST')[1][1].body).requestId).toBe('original-request');
});

it('imports only reviewed bank rows and reports duplicate conflicts', async () => {
  const fetch = vi.fn(async (url, options) => ({ ok: true, json: async () => url.endsWith('/inspect')
    ? { batchId: 'batch', headers: ['Ref', 'Date', 'Credit'], suggestedMapping: { transactionId: 'Ref', date: 'Date', creditInr: 'Credit' } }
    : url.endsWith('/validate') ? { rows: [{ rowNumber: 2, state: 'accepted', issues: [], item: { transactionId: 'REF-1', date: '2026-11-03', creditPaise: 10000, debitPaise: 0 } }] }
      : url.endsWith('/commit') ? { savedCount: 0, skippedCount: 1, duplicateConflicts: [{ changed: true }] } : { ...listing(), transactions: [] } }));
  vi.stubGlobal('fetch', fetch); render(<BankReconciliation workspaceId="w" />);
  fireEvent.change(screen.getByLabelText('Bank account name'), { target: { value: 'MAIN' } });
  fireEvent.change(screen.getByLabelText('Bank statement CSV or XLSX'), { target: { files: [new File(['data'], 'bank.csv', { type: 'text/csv' })] } });
  fireEvent.submit(screen.getByRole('button', { name: 'Inspect bank statement' }).closest('form'));
  fireEvent.click(await screen.findByRole('button', { name: 'Validate bank rows' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import reviewed bank rows' }));
  await screen.findByText(/1 duplicate references have changed details/);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/commit'))).toHaveLength(1);
});

it('requires a review note before excluding an unmatched debit', async () => {
  const debit = { ...transaction, creditPaise: 0, debitPaise: 1000, availablePaise: 0, suggestions: [] };
  const fetch = vi.fn(async (_url, options) => ({ ok: true, json: async () => options?.method === 'PATCH' ? {} : listing(debit) }));
  vi.stubGlobal('fetch', fetch); render(<BankReconciliation workspaceId="w" />);
  fireEvent.change(await screen.findByLabelText('Review note for UTR-1'), { target: { value: 'Fee already recorded in cash expenses' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mark unmatched amount reviewed separately' }));
  await waitFor(() => expect(fetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(true));
  expect(JSON.parse(fetch.mock.calls.find(([, o]) => o?.method === 'PATCH')[1].body)).toEqual({ state: 'excluded', note: 'Fee already recorded in cash expenses' });
});

it('retains an uncertain submission’s idempotency key across screen remounts', async () => {
  let fail = true;
  const fetch = vi.fn(async (_url, options) => {
    if (options?.method === 'POST' && fail) throw new Error('Lost response');
    return { ok: true, json: async () => options?.method === 'POST' ? {} : listing() };
  });
  vi.stubGlobal('fetch', fetch);
  const first = render(<BankReconciliation workspaceId="w" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use suggestion' }));
  fireEvent.change(screen.getByLabelText('Amount to match (₹)'), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm match' }));
  await screen.findByText('Lost response');
  first.unmount(); fail = false;
  render(<BankReconciliation workspaceId="w" />);
  await screen.findByLabelText('Amount to match (₹)');
  expect(screen.getByLabelText('Amount to match (₹)').value).toBe('50');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm match' }));
  await screen.findByText('Payment matched. Invoice balance and forecast updated.');
  const posts = fetch.mock.calls.filter(([, o]) => o?.method === 'POST');
  expect(JSON.parse(posts[0][1].body).requestId).toBe(JSON.parse(posts[1][1].body).requestId);
});

it('uses a new request after a definitive rejection so a corrected invoice can be matched', async () => {
  let rejected = true;
  const fetch = vi.fn(async (_url, options) => options?.method === 'POST'
    ? { ok: !rejected, status: rejected ? 400 : 200, json: async () => rejected ? { error: { message: 'Verify the invoice before matching a bank receipt' } } : {} }
    : { ok: true, json: async () => listing() });
  vi.stubGlobal('fetch', fetch); render(<BankReconciliation workspaceId="w" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use suggestion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm match' }));
  await screen.findByText('Verify the invoice before matching a bank receipt');
  rejected = false;
  fireEvent.click(screen.getByRole('button', { name: 'Confirm match' }));
  await screen.findByText('Payment matched. Invoice balance and forecast updated.');
  const posts = fetch.mock.calls.filter(([, o]) => o?.method === 'POST');
  expect(JSON.parse(posts[0][1].body).requestId).not.toBe(JSON.parse(posts[1][1].body).requestId);
});
