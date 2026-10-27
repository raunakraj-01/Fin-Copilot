// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OrderAnalyzer from '../../client/src/pages/OrderAnalyzer.jsx';
import RescuePlanner from '../../client/src/pages/RescuePlanner.jsx';
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
