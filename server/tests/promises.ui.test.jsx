// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaymentPromises from '../../client/src/components/PaymentPromises.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const promise = { id: 'p', amountPaise: 6000000, receivedPaise: 1000000, remainingPaise: 5000000,
  promisedDate: '2026-11-03', status: 'broken', history: [{ action: 'created', at: '2026-11-01T00:00:00Z', promisedDate: '2026-11-03' }] };
function mockFetch({ existing = true, fail = false } = {}) {
  const result = { asOfDate: '2026-11-04', items: [{ id: 'invoice', externalId: 'INV-1', counterparty: 'Buyer',
    outstandingPaise: 5000000, status: 'partial', promises: existing ? [promise] : [] }] };
  const fetch = vi.fn(async (url, options) => ({ ok: !(fail && options?.method), status: fail && options?.method ? 400 : 200,
    json: async () => options?.method ? fail ? { error: { message: 'Promises cannot exceed the outstanding invoice balance' } } : {}
      : url.endsWith('/forecast') ? { promiseRisks: [{ promiseId: 'p', comparison: 'Payments exposed while this overdue receipt is excluded',
        affectedPayments: [{ id: 'wages', label: 'Wages', date: '2026-11-05', amountPaise: 4000000, gapPaise: 3000000 }] }] } : result }));
  vi.stubGlobal('fetch', fetch); return fetch;
}
it('shows broken promises, history and upcoming exposed payments', async () => {
  mockFetch(); render(<PaymentPromises workspaceId="w" />);
  expect(await screen.findByText(/by 2026-11-03 · Broken/)).toBeTruthy();
  expect(screen.getByText(/2026-11-05 · Wages/)).toBeTruthy();
  fireEvent.click(screen.getByText('Promise history'));
  expect(screen.getByText(/created/)).toBeTruthy();
});
it('creates an installment in integer paise and refreshes the parent forecast', async () => {
  const fetch = mockFetch({ existing: false }); const changed = vi.fn();
  render(<PaymentPromises workspaceId="w" onChanged={changed} />);
  await screen.findByText(/INV-1 ·/);
  fireEvent.change(screen.getByLabelText('Promise invoice'), { target: { value: 'invoice' } });
  fireEvent.change(screen.getByLabelText('Promised amount (₹)'), { target: { value: '10000.29' } });
  fireEvent.change(screen.getByLabelText('Promised payment date'), { target: { value: '2026-11-07' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save promise' }));
  await screen.findByText('Promise saved. Forecast updated.');
  const [url, options] = fetch.mock.calls.find(([, opts]) => opts?.method);
  expect(url.endsWith('/items/invoice/promises')).toBe(true);
  expect(JSON.parse(options.body)).toMatchObject({ amountPaise: 1000029, promisedDate: '2026-11-07' });
  expect(changed).toHaveBeenCalledTimes(1);
});
it('revises only the remaining amount and keeps API validation errors visible', async () => {
  const fetch = mockFetch({ fail: true }); render(<PaymentPromises workspaceId="w" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revise promise' }));
  expect(screen.getByLabelText('Promised amount (₹)').value).toBe('50000');
  fireEvent.change(screen.getByLabelText('Promised payment date'), { target: { value: '2026-11-07' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save promise' }));
  await screen.findByText('Promises cannot exceed the outstanding invoice balance');
  expect(fetch.mock.calls.find(([, opts]) => opts?.method)[1].method).toBe('PATCH');
});
it('confirms dated receipts with an idempotency key and cancels with a distinct action', async () => {
  const fetch = mockFetch(); render(<PaymentPromises workspaceId="w" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
  fireEvent.change(screen.getByLabelText('Received amount (₹)'), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm payment' }));
  await screen.findByText('Payment confirmed. Invoice balance and forecast updated.');
  const [url, options] = fetch.mock.calls.find(([, opts]) => opts?.method);
  expect(url.endsWith('/promises/p/receipts')).toBe(true);
  expect(JSON.parse(options.body)).toMatchObject({ amountPaise: 50000, receivedDate: '2026-11-04', requestId: expect.any(String) });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel promise' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.endsWith('/promises/p/cancel'))).toBe(true));
});
