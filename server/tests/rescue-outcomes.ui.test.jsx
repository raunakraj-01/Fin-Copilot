// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavedPlans from '../../client/src/pages/RescuePlanner/SavedPlans.jsx';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const action = { actionId: 'a', cashItemId: 'invoice', type: 'accelerate_collection', amountPaise: 60000,
  toDate: '2026-11-03', feeDate: '2026-11-03', estimatedCostPaise: 0, status: 'agreed', ownerNotes: '', promiseId: 'p' };
function plan(status = 'tracking_promise', gap = 0) {
  return { _id: 'plan', asOfDate: '2026-11-01', feasibility: 'conditional', simulatedWorstCashPaise: 20000, actions: [action],
    live: { evaluatedAsOfDate: '2026-11-04', horizonEnd: '2027-02-01', status: gap ? 'insufficient' : 'conditional',
      baseline: { minimumCashPaise: -40000 }, current: { minimumCashPaise: gap ? -gap : 20000, firstReserveBreachDate: gap ? '2026-11-05' : null, gapPaise: gap },
      actions: [{ actionId: 'a', status, remainingActionPaise: 60000, observedSettlementPaise: 0, messages: ['Promise is included once.'],
        availablePromises: [{ id: 'p', amountPaise: 60000, promisedDate: '2026-11-03', status: 'pending' }] }],
      signals: gap ? [{ type: 'broken_promise', amountPaise: 60000, date: '2026-11-03' }] : [],
      affectedPayments: gap ? [{ label: 'Wages', date: '2026-11-05', amountPaise: 60000, gapPaise: gap }] : [], warnings: [] } };
}

it('refreshes live outcomes on window focus and shows broken promises and affected payments', async () => {
  let latest = plan();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ plans: [latest] }) })));
  render(<SavedPlans workspaceId="w" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved plans' }));
  await screen.findByText(/Current outcome: tracking promise/);
  latest = plan('broken_promise', 40000);
  fireEvent(window, new Event('focus'));
  await screen.findByText(/Current outcome: broken promise/);
  expect(screen.getByText(/2026-11-05 · Wages/)).toBeTruthy();
  expect(screen.getByText(/Simulated lowest cash when saved/).textContent).toContain('200');
});

it('updates action status and replaces the live forecast from the response immediately', async () => {
  const rejected = { ...plan('rejected', 40000), actions: [{ ...action, status: 'rejected' }] };
  const fetch = vi.fn(async (_url, options) => ({ ok: true, json: async () => options?.method === 'PATCH' ? rejected : { plans: [plan()] } }));
  vi.stubGlobal('fetch', fetch); render(<SavedPlans workspaceId="w" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved plans' }));
  fireEvent.change(await screen.findByLabelText('Action status'), { target: { value: 'rejected' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update action' }));
  await screen.findByText(/Current outcome: rejected/);
  expect(screen.getByText(/Current plan forecast recalculated/)).toBeTruthy();
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ status: 'rejected', ownerNotes: '' });
});

it('links a selected promise without accepting client-provided money fields', async () => {
  const saved = { ...plan(), actions: [{ ...action, promiseId: null }] };
  const fetch = vi.fn(async (_url, options) => ({ ok: true, json: async () => options?.method === 'PATCH' ? plan() : { plans: [saved] } }));
  vi.stubGlobal('fetch', fetch); render(<SavedPlans workspaceId="w" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved plans' }));
  fireEvent.change(await screen.findByLabelText('Linked payment promise'), { target: { value: 'p' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update action' }));
  await waitFor(() => expect(fetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(true));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ status: 'agreed', ownerNotes: '', promiseId: 'p' });
});

it('prevents an old background response from restoring a rejected action’s benefit', async () => {
  let resolvePoll;
  let requests = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options?.method === 'PATCH') return { ok: true, json: async () => ({ ...plan('rejected', 40000), actions: [{ ...action, status: 'rejected' }] }) };
    requests++;
    if (requests === 2) return new Promise(resolve => { resolvePoll = resolve; });
    return { ok: true, json: async () => ({ plans: [plan()] }) };
  }));
  render(<SavedPlans workspaceId="w" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved plans' }));
  await screen.findByLabelText('Action status');
  fireEvent(window, new Event('focus'));
  fireEvent.change(screen.getByLabelText('Action status'), { target: { value: 'rejected' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update action' }));
  await screen.findByText(/Current outcome: rejected/);
  resolvePoll({ ok: true, json: async () => ({ plans: [plan()] }) });
  await waitFor(() => expect(screen.getByText(/Current outcome: rejected/)).toBeTruthy());
});
