// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Outlook from '../../client/src/pages/Outlook.jsx';
import SetupImport from '../../client/src/pages/SetupImport.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows the daily snapshot, freshness, reserve-aware headroom, and prioritized review links', async () => {
  const forecast = {
    asOfDate: '2026-11-20', openingCashPaise: 1_000_000, minimumReservePaise: 200_000, horizonDays: 90,
    daily: [{ date: '2026-11-20', closingCashPaise: 1_000_000, events: [] },
      { date: '2026-11-25', closingCashPaise: 100_000, events: [] }],
    risk: { firstNegativeDate: null, firstReserveBreachDate: '2026-11-25', worstCashPaise: 100_000,
      worstDate: '2026-11-25', contributingItems: [], explanation: 'Cash falls below reserve on 2026-11-25.' },
    warnings: [], promiseRisks: [],
    cashDesk: {
      snapshotDate: '2026-11-20', safeToSpendPaise: 0,
      dataFreshness: { lastUpdatedAt: '2026-11-12T00:00:00.000Z', staleDays: 8, stale: true,
        lastSuccessfulSyncAt: '2026-11-12T00:00:00.000Z' },
      unresolvedIssues: { totalCount: 2,
        bankRows: [{ transactionId: 'UTR-1', amountPaise: 50_000 }],
        cashItems: [{ cashItemId: 'invoice', externalId: 'INV-1', counterparty: 'Buyer', amountPaise: 80_000, reason: 'verification' }] },
    },
  };
  const fetch = vi.fn(async url => {
    if (url.includes('/forecast')) return { ok: true, status: 200, json: async () => forecast };
    if (url.includes('/promises')) return { ok: true, status: 200, json: async () => ({ asOfDate: forecast.asOfDate, items: [] }) };
    return { ok: false, status: 503, json: async () => ({ error: { message: 'Unavailable' } }) };
  });
  vi.stubGlobal('fetch', fetch);
  const onNavigate = vi.fn();
  render(<Outlook workspaceId="business" onNavigate={onNavigate} />);

  await screen.findByText(/Cash snapshot: 2026-11-20/);
  expect(screen.getByText('₹0.00')).toBeTruthy();
  expect(screen.getByText('Stale - 8 days')).toBeTruthy();
  expect(screen.getByText('2 unresolved data issues')).toBeTruthy();
  expect(screen.getByText(/Protect the reserve before 2026-11-25/)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Review' })).toHaveLength(3);
  fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
  expect(onNavigate).toHaveBeenCalledWith('rescue');
});

it('requires confirming the exact opening balance and snapshot date before creating a workspace', () => {
  render(<SetupImport onWorkspaceCreated={() => {}} />);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const today = Object.fromEntries(parts.map(part => [part.type, part.value]));
  expect(screen.getByLabelText(/As-of date/).value).toBe(`${today.year}-${today.month}-${today.day}`);
  const create = screen.getByRole('button', { name: 'Create new workspace' });
  expect(create.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Opening cash/), { target: { value: '45000' } });
  const confirmation = screen.getByLabelText('I confirm this opening balance matches the bank balance on the selected as-of date.');
  fireEvent.click(confirmation);
  expect(create.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText(/Opening cash/), { target: { value: '46000' } });
  expect(confirmation.checked).toBe(false);
  expect(create.disabled).toBe(true);
});
