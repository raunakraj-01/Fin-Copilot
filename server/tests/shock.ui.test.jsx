// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CashShockLab from '../../client/src/pages/CashShockLab.jsx';
import { analyzeShock } from '../src/services/finance/shock.js';
import { explainReport } from '../src/services/finance/explain.js';
import { buildForecast } from '../src/services/finance/forecast.js';
import { fixtureContext } from './rescueFixtureSupport.mjs';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('empty workspace directs users to Setup', () => {
  render(<CashShockLab />);
  expect(screen.getByText(/Create or select a workspace/)).toBeTruthy();
});
test('stress controls clear stale results, rerun analysis, and render grounded explanations', async () => {
  const fetch = vi.fn(async (url, init) => {
    const { question, ...options } = JSON.parse(init.body);
    const report = analyzeShock(fixtureContext(), options, buildForecast);
    return { ok: true, json: async () => question ? explainReport(report, question, { apiKey: '' }) : report };
  });
  vi.stubGlobal('fetch', fetch);
  render(<CashShockLab workspaceId="workspace" apiBaseUrl="/api" />);
  await screen.findByRole('heading', { name: 'Whom should I call first?' });
  expect(screen.getByRole('heading', { name: 'Cash Shock Lab' })).toBeTruthy();
  expect(screen.getAllByText('Acme Retail Pvt Ltd').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Payment delay'), { target: { value: '15' } });
  expect(screen.queryByRole('heading', { name: 'Whom should I call first?' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Run stress test' }));
  await screen.findByRole('heading', { name: 'Whom should I call first?' });
  expect(JSON.parse(fetch.mock.calls.at(-1)[1].body).delayDays).toBe(15);
  fireEvent.click(screen.getByRole('button', { name: 'Which collection helps most?' }));
  await screen.findByText('Calculated explanation · AI is not configured.');
  expect(screen.getByRole('heading', { name: 'Which collection helps most?' })).toBeTruthy();
  expect(screen.getAllByRole('link', { name: 'INV-R100' }).every(link => link.getAttribute('href') === '#cash-source-INV-R100')).toBe(true);
});
test('workspace changes abort requests and ignore stale responses', async () => {
  const requests = [];
  vi.stubGlobal('fetch', vi.fn((url, init) => new Promise(resolve => requests.push({ url, init, resolve }))));
  const view = render(<CashShockLab workspaceId="first" apiBaseUrl="/api" />);
  view.rerender(<CashShockLab workspaceId="second" apiBaseUrl="/api" />);
  expect(requests[0].init.signal.aborted).toBe(true);
  requests[0].resolve({ ok: true, json: async () => analyzeShock(fixtureContext(), {}, buildForecast) });
  requests[1].resolve({ ok: false, json: async () => ({ error: { message: 'Workspace not found' } }) });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Workspace not found'));
  expect(screen.queryByRole('heading', { name: 'Source records' })).toBeNull();
});
