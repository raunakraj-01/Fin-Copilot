// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OrderAnalyzer from '../../client/src/pages/OrderAnalyzer.jsx';
import RescuePlanner from '../../client/src/pages/RescuePlanner.jsx';
import SavedPlans from '../../client/src/pages/RescuePlanner/SavedPlans.jsx';
import SavedScenarios, { SaveScenario } from '../../client/src/pages/OrderAnalyzer/SavedScenarios.jsx';
import { analyzeNewOrder } from '../src/services/orders/analyze.js';
import { buildForecast } from './rescueForecastStub.mjs';
import { draftOrder, isolatedContext } from './rescueFixtureSupport.mjs';

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { constructor(callback) { this.callback = callback; } observe() { this.callback([{ contentRect: { width: 760, height: 270 } }]); } unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('both pages explain the empty workspace state', () => {
  render(<><OrderAnalyzer /><RescuePlanner /></>);
  expect(screen.getAllByText(/Create or select a workspace/)).toHaveLength(2);
});
test('order form sends integer paise, multiple payments and renders computed threshold', async () => {
  const result = analyzeNewOrder(isolatedContext(), draftOrder(), buildForecast);
  const fetch = vi.fn(async () => ({ ok: true, json: async () => result })); vi.stubGlobal('fetch', fetch);
  render(<OrderAnalyzer workspaceId="workspace" apiBaseUrl="/api" />);
  fireEvent.change(screen.getByLabelText('Order value (₹)'), { target: { value: '₹8,00,000' } });
  fireEvent.change(screen.getByLabelText('Advance date'), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText('Final collection date'), { target: { value: '2026-12-31' } });
  fireEvent.change(screen.getByLabelText('Payment 1 amount (₹)'), { target: { value: '5,00,000' } });
  fireEvent.change(screen.getByLabelText('Payment 1 date'), { target: { value: '2026-11-11' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
  fireEvent.change(screen.getByLabelText('Payment 2 amount (₹)'), { target: { value: '0.29' } });
  fireEvent.change(screen.getByLabelText('Payment 2 date'), { target: { value: '2026-11-12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Analyze order' }));
  await screen.findByRole('heading', { name: /Minimum advance/ });
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.orderValuePaise).toBe(80_000_000); expect(body.costLines[1].amountPaise).toBe(29);
  expect(screen.getByRole('heading', { name: /Minimum advance/ }).textContent).toContain('4,00,000');
  fireEvent.change(screen.getByLabelText('Proposed advance (₹)'), { target: { value: '400000' } });
  expect(screen.queryByRole('heading', { name: /Minimum advance/ })).toBeNull();
});
test('rescue page renders API failures and can retry', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'Workspace not found' } }) })));
  render(<RescuePlanner workspaceId="workspace" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Find rescue options' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Workspace not found');
  expect(screen.getByRole('button', { name: 'Find rescue options' }).disabled).toBe(false);
});
test('changing workspace aborts pending requests and ignores stale results', async () => {
  let resolve;
  const fetch = vi.fn(() => new Promise(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
  const view = render(<RescuePlanner workspaceId="first" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Find rescue options' }));
  const signal = fetch.mock.calls[0][1].signal;
  view.rerender(<RescuePlanner workspaceId="second" apiBaseUrl="/api" />);
  expect(signal.aborted).toBe(true);
  resolve({ ok: true, json: async () => ({ baseline: { worstCashPaise: 0 }, plans: [], partialMitigations: [], message: 'Stale result' }) });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Find rescue options' }).disabled).toBe(false));
  expect(screen.queryByText('Stale result')).toBeNull();
});

test('saving a displayed rescue proposal sends only objective and actions', async () => {
  const day = { date: '2026-11-02', closingCashPaise: 0 };
  const actions = [{ cashItemId: '000000000000000000000001', type: 'accelerate_collection', amountPaise: 20_000_000, fromDate: '2026-11-26', toDate: '2026-11-04' }];
  const analysis = { baseline: { worstCashPaise: -20_000_000, daily: [day] }, candidateCount: 1, plans: [{ planId: 'simulation-1', fullyFeasible: true, worstCashPaiseAfter: 0, knownActionCostPaise: 0, actions, daily: [day], warnings: [] }], partialMitigations: [], warnings: [], assumptions: [] };
  const fetch = vi.fn(async (url, options) => url.endsWith('/plans')
    ? { ok: true, json: async () => options?.method === 'POST' ? ({ _id: 'saved-plan' }) : ({ plans: [] }) }
    : { ok: true, json: async () => analysis });
  vi.stubGlobal('fetch', fetch);
  render(<RescuePlanner workspaceId="workspace" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Find rescue options' }));
  const buttons = await screen.findAllByRole('button', { name: 'Save proposed plan' });
  fireEvent.click(buttons[0]);
  expect((await screen.findByText(/Plan saved as a proposal/)).textContent).toContain('Cash records were not changed');
  const [url, options] = fetch.mock.calls[1];
  expect(url).toBe('/api/workspaces/workspace/rescue/plans');
  expect(JSON.parse(options.body)).toEqual({ objective: 'nonnegative', actions: analysis.plans[0].actions });
});

test('order saving sends analyzed inputs and displays the recalculated saved threshold', async () => {
  const order = draftOrder(); const onSaved = vi.fn();
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ _id: 'saved-order', simulatedMinimumAdvancePaise: 40_000_000 }) }));
  vi.stubGlobal('fetch', fetch);
  render(<SaveScenario order={order} workspaceId="workspace" apiBaseUrl="/api" onSaved={onSaved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save hypothetical scenario' }));
  expect((await screen.findByRole('status')).textContent).toContain('4,00,000');
  expect(fetch.mock.calls[0][0]).toBe('/api/workspaces/workspace/orders/scenarios');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(order);
  expect(onSaved).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Scenario saved' }).disabled).toBe(true);
});

test('saved scenario list labels an impossible advance correctly', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ scenarios: [{ _id: 'scenario', label: 'Late advance', ...draftOrder(), simulatedMinimumAdvancePaise: null, scenarioWarnings: [] }] }) })));
  render(<SavedScenarios workspaceId="workspace" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved scenarios' }));
  expect((await screen.findByText(/Minimum advance when saved/)).textContent).toContain('No feasible advance');
});

test('saved action tracking sends status and notes without changing financial fields', async () => {
  const plan = { _id: 'plan', asOfDate: '2026-11-01', feasibility: 'conditional', simulatedWorstCashPaise: 0, actions: [{ actionId: 'action-1', type: 'accelerate_collection', amountPaise: 20_000_000, toDate: '2026-11-04', status: 'proposed', ownerNotes: '' }] };
  const fetch = vi.fn(async (_url, options) => ({ ok: true, json: async () => options?.method === 'PATCH' ? plan : { plans: [plan] } }));
  vi.stubGlobal('fetch', fetch);
  const view = render(<SavedPlans workspaceId="first" apiBaseUrl="/api" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved plans' }));
  fireEvent.change(await screen.findByLabelText('Action status'), { target: { value: 'agreed' } });
  fireEvent.change(screen.getByLabelText('Owner notes'), { target: { value: 'Customer confirmed date' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update action' }));
  await screen.findByText(/Action updated/);
  expect(fetch.mock.calls[1][0]).toBe('/api/workspaces/first/rescue/plans/plan/actions/action-1');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ status: 'agreed', ownerNotes: 'Customer confirmed date' });
  view.rerender(<SavedPlans workspaceId="second" apiBaseUrl="/api" />);
  expect(screen.queryByLabelText('Action status')).toBeNull();
});
