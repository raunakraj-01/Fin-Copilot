// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ManualRecords from '../../client/src/components/ManualRecords.jsx';
import { itemInput } from '../src/validators/finance.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('explains a fully settled Open invoice and saves it after choosing Paid', async () => {
  const fetchMock = vi.fn(async (url, options) => ({ ok: true, status: options?.method === 'POST' ? 201 : 200,
    json: async () => url.endsWith('/recurring-rules') ? { recurringRules: [] } : { items: [] } }));
  vi.stubGlobal('fetch', fetchMock);
  render(<ManualRecords workspaceId="workspace" />);
  fireEvent.change(screen.getByLabelText('Source ID'), { target: { value: 'INV-DEMO-002' } });
  fireEvent.change(screen.getByLabelText('Counterparty'), { target: { value: 'Raunak Builders' } });
  fireEvent.change(screen.getAllByLabelText('Amount (₹)')[0], { target: { value: '50000' } });
  fireEvent.change(screen.getByLabelText('Already settled (₹)'), { target: { value: '50000' } });
  fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add cash item' }));
  expect(await screen.findByText(/fully settled. Choose Paid/)).toBeTruthy();
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add cash item' }));
  await screen.findByText('Cash item saved.');
  const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(itemInput.safeParse(JSON.parse(options.body)).success).toBe(true);
});

it('shows the API field-level validation message next to the cash item form', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url, options) => options?.method === 'POST'
    ? { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid request data', details: [{ field: 'expectedDate', message: 'Must be a valid YYYY-MM-DD date' }] } }) }
    : { ok: true, status: 200, json: async () => url.endsWith('/recurring-rules') ? { recurringRules: [] } : { items: [] } }));
  render(<ManualRecords workspaceId="workspace" />);
  fireEvent.change(screen.getByLabelText('Counterparty'), { target: { value: 'Buyer' } });
  fireEvent.change(screen.getAllByLabelText('Amount (₹)')[0], { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add cash item' }));
  await waitFor(() => expect(screen.getByText('Expected cash date: Must be a valid YYYY-MM-DD date')).toBeTruthy());
});
