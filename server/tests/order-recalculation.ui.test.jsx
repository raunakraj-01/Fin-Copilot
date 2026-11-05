// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavedScenarios from '../../client/src/pages/OrderAnalyzer/SavedScenarios.jsx';
import OrderAnalyzer from '../../client/src/pages/OrderAnalyzer.jsx';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const scenario = stale => ({ _id: 's', label: 'Materials order', orderValuePaise: 40000, advancePaise: 0,
  advanceDate: '2026-11-02', finalCollectionDate: '2026-11-20', delayedCollectionDays: 14,
  costLines: [{ description: 'Materials', amountPaise: 30000, paymentDate: '2026-11-03' }],
  simulatedMinimumAdvancePaise: stale ? 25000 : 30000, analyzedAt: '2026-11-01T12:00:00Z',
  analysisContext: { asOfDate: '2026-11-01' }, scenarioWarnings: [],
  freshness: { stale, message: stale ? 'Cash settings changed. Recalculate.' : 'Current recorded inputs.', datesExpired: false },
  analysisHistory: stale ? [] : [{ analyzedAt: '2026-11-01T00:00:00Z', minimumAdvancePaise: 25000, analysisContext: { asOfDate: '2026-11-01' } }] });

it('flags changed analyses on focus and replaces a historical threshold after one-click recalculation', async () => {
  let current = scenario(false);
  const fetch = vi.fn(async (_url, options) => ({ ok: true, json: async () => options?.method === 'POST' ? scenario(false) : { scenarios: [current] } }));
  vi.stubGlobal('fetch', fetch); render(<SavedScenarios workspaceId="w" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved scenarios' }));
  await screen.findByText('Analysis matches current recorded inputs');
  current = scenario(true); fireEvent(window, new Event('focus'));
  await screen.findByText('Outdated analysis — review before use');
  fireEvent.click(screen.getByRole('button', { name: 'Recalculate with current ledger' }));
  await screen.findByText(/Recalculated and saved using current cash records/);
  expect(screen.getByText(/Minimum advance when saved/).textContent).toContain('300');
  expect(screen.getByText('Previous calculations')).toBeTruthy();
  const [url, options] = fetch.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(url).toBe('/api/workspaces/w/orders/scenarios/s/recalculate');
  expect(JSON.parse(options.body)).toEqual({});
});

it('preserves stale status on API failure and allows a retry', async () => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => options?.method === 'POST'
    ? { ok: !fail, json: async () => fail ? { error: { message: 'Cash inputs changed during recalculation. Refresh and retry.' } } : scenario(false) }
    : { ok: true, json: async () => ({ scenarios: [scenario(true)] }) }));
  render(<SavedScenarios workspaceId="w" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved scenarios' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Recalculate with current ledger' }));
  await screen.findByText('Cash inputs changed during recalculation. Refresh and retry.');
  expect(screen.getByText('Outdated analysis — review before use')).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Recalculate with current ledger' }));
  await screen.findByText('Analysis matches current recorded inputs');
});

it('disables recalculation for expired dates and loads saved inputs into the analyzer for correction', async () => {
  const expired = { ...scenario(true), freshness: { stale: true, datesExpired: true, message: 'Edit order dates before recalculating.' } };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ scenarios: [expired] }) })));
  render(<OrderAnalyzer workspaceId="w" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved scenarios' }));
  expect((await screen.findByRole('button', { name: 'Recalculate with current ledger' })).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Edit order inputs' }));
  expect(screen.getByLabelText('Order label').value).toBe('Materials order');
  expect(screen.getByLabelText('Order value (₹)').value).toBe('400.00');
  expect(screen.getByLabelText('Advance date').value).toBe('2026-11-02');
  expect(screen.getByLabelText('Delay stress test (days)').value).toBe('14');
  expect(screen.getByLabelText('Payment 1 amount (₹)').value).toBe('300.00');
  expect(screen.getByText(/Saved order loaded into the form/)).toBeTruthy();
});

it('ignores a stale background poll after a successful recalculation', async () => {
  let resolvePoll;
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options?.method === 'POST') return { ok: true, json: async () => scenario(false) };
    if (++reads === 2) return new Promise(resolve => { resolvePoll = resolve; });
    return { ok: true, json: async () => ({ scenarios: [scenario(true)] }) };
  }));
  render(<SavedScenarios workspaceId="w" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved scenarios' }));
  await screen.findByText('Outdated analysis — review before use');
  fireEvent(window, new Event('focus'));
  fireEvent.click(screen.getByRole('button', { name: 'Recalculate with current ledger' }));
  await screen.findByText('Analysis matches current recorded inputs');
  resolvePoll({ ok: true, json: async () => ({ scenarios: [scenario(true)] }) });
  await waitFor(() => expect(screen.queryByText('Outdated analysis — review before use')).toBeNull());
});

it('does not display a recalculation response from the previous business', async () => {
  let resolveOld;
  vi.stubGlobal('fetch', vi.fn(async (url, options) => options?.method === 'POST' ? new Promise(resolve => { resolveOld = resolve; })
    : { ok: true, json: async () => ({ scenarios: url.includes('/old/') ? [scenario(true)] : [] }) }));
  const view = render(<SavedScenarios workspaceId="old" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved scenarios' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Recalculate with current ledger' }));
  view.rerender(<SavedScenarios workspaceId="new" apiBaseUrl="/api" />);
  resolveOld({ ok: true, json: async () => scenario(false) });
  await waitFor(() => expect(screen.queryByText('Materials order · hypothetical')).toBeNull());
  expect(screen.queryByText('Analysis matches current recorded inputs')).toBeNull();
});
