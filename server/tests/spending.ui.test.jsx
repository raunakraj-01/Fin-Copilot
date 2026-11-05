// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpendingCheck from '../../client/src/components/SpendingCheck.jsx';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const scenario = { spendablePaise: 80000, minimumBalancePaise: 100000, minimumDate: '2026-11-05', reserveGapPaise: 0,
  firstReserveBreachDate: null, canSpend: true, afterSpendMinimumPaise: 100000, includedReceiptsPaise: 80000, includedPaymentsPaise: 60000 };
function response(url) {
  const params = new URL(url).searchParams;
  const confirmed = params.get('commitmentsConfirmed') === 'true';
  const spending = Number(params.get('spendPaise'));
  return { status: confirmed ? 'conditional' : 'incomplete', asOfDate: '2026-11-05', endDate: '2026-12-04', minimumReservePaise: 20000,
    delayDays: Number(params.get('delayDays')), expected: { ...scenario, spendablePaise: confirmed ? 80000 : null, canSpend: confirmed ? spending <= 80000 : null },
    delayed: { ...scenario, spendablePaise: confirmed ? 20000 : null, canSpend: confirmed ? spending <= 20000 : null,
      firstBreachAfterSpend: spending > 20000 ? '2026-11-09' : null, afterSpendMinimumPaise: 40000 - spending },
    recommendedSpendablePaise: confirmed ? 20000 : null,
    dataQuality: { issues: confirmed ? [] : [{ code: 'CONFIRM_COMMITMENTS', message: 'Confirm all commitments.', amountPaise: 0 }] }, assumptions: ['Lowest daily balance less reserve.'] };
}
function mockFetch() {
  const fetch = vi.fn(async url => ({ ok: true, status: 200, json: async () => response(url) }));
  vi.stubGlobal('fetch', fetch); return fetch;
}
const confirm = () => fireEvent.click(screen.getByRole('checkbox'));

it('withholds spending figures until commitments are confirmed, then compares both scenarios', async () => {
  mockFetch(); render(<SpendingCheck workspaceId="w" refreshKey={0} />);
  await screen.findByText(/Data incomplete/);
  expect(screen.getAllByText('Unavailable')).toHaveLength(2);
  confirm();
  expect(await screen.findByText(/Limit that preserves the reserve in both scenarios/)).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Expected payments' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Payments 7 days late' })).toBeTruthy();
});

it('sends proposed spending as integer paise and shows the delayed breach', async () => {
  const fetch = mockFetch(); render(<SpendingCheck workspaceId="w" refreshKey={0} />);
  confirm(); await screen.findByText(/Limit that preserves/);
  fireEvent.change(screen.getByLabelText('Proposed spending (₹)'), { target: { value: '200.01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check this payment' }));
  expect(await screen.findByText(/Your proposed payment breaches the reserve on 2026-11-09/)).toBeTruthy();
  expect(fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('spendPaise') === '20001')).toBe(true);
  fireEvent.change(screen.getByLabelText('Proposed spending (₹)'), { target: { value: '1' } });
  expect(screen.queryByText(/Your proposed payment breaches/)).toBeNull();
});

it('refreshes delay assumptions and invalidates confirmation when horizon or ledger changes', async () => {
  const fetch = mockFetch(); const view = render(<SpendingCheck workspaceId="w" refreshKey={0} />);
  confirm(); await screen.findByText(/Limit that preserves/);
  fireEvent.change(screen.getByLabelText('Customer payment delay'), { target: { value: '15' } });
  await screen.findByRole('heading', { name: 'Payments 15 days late' });
  fireEvent.change(screen.getByLabelText('Planning period'), { target: { value: '60' } });
  expect(screen.getByRole('checkbox').checked).toBe(false);
  await screen.findByText(/Data incomplete/);
  confirm(); await screen.findByText(/Limit that preserves/);
  view.rerender(<SpendingCheck workspaceId="w" refreshKey={1} />);
  expect(screen.queryByText(/Limit that preserves/)).toBeNull();
  expect(screen.getByRole('checkbox').checked).toBe(false);
  await waitFor(() => expect(fetch.mock.calls.at(-1)[0]).toContain('commitmentsConfirmed=false'));
});

it('ignores stale responses when switching businesses', async () => {
  let resolveOld;
  vi.stubGlobal('fetch', vi.fn(url => url.includes('/old/') ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ ok: true, status: 200, json: async () => response(url) })));
  const view = render(<SpendingCheck workspaceId="old" refreshKey={0} />);
  view.rerender(<SpendingCheck workspaceId="new" refreshKey={0} />);
  await screen.findByText(/Data incomplete/);
  resolveOld({ ok: true, json: async () => ({ ...response('http://localhost/?commitmentsConfirmed=true&delayDays=7'), recommendedSpendablePaise: 999999999 }) });
  await waitFor(() => expect(screen.queryByText(/Limit that preserves/)).toBeNull());
});

it('shows network errors and can retry without displaying an old spending limit', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('Network unavailable'))
    .mockImplementation(async url => ({ ok: true, json: async () => response(url) }));
  vi.stubGlobal('fetch', fetch);
  render(<SpendingCheck workspaceId="w" refreshKey={0} />);
  await screen.findByText('Network unavailable');
  expect(screen.queryByText(/Limit that preserves/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry spending check' }));
  await screen.findByText(/Data incomplete/);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('explains an existing reserve breach instead of claiming a zero limit preserves cash', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => { const value = response(url); return { ok: true, json: async () => ({ ...value,
    status: 'conditional', recommendedSpendablePaise: 0, expected: { ...value.expected, spendablePaise: 0, reserveGapPaise: 10000, firstReserveBreachDate: '2026-11-05' } }) }; }));
  render(<SpendingCheck workspaceId="w" refreshKey={0} />);
  await screen.findByText('No additional spending room. The existing plan already falls below reserve.');
  expect(screen.queryByText(/Limit that preserves/)).toBeNull();
});
