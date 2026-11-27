// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BusinessApp } from '../../client/src/app/App.jsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('shows Try our demo in the business dropdown, opens the demo on Cash Outlook without Unavailable, and resets cleanly', async () => {
  const demoWorkspace = {
    id: 'demo-ws-1',
    name: 'Kalyani Precision Components Pvt Ltd (Demo)',
    asOfDate: '2026-11-28',
    openingCashPaise: 42_500_000,
    minimumReservePaise: 15_000_000,
    businessGstin: '29AAACK4829M1Z5',
    isDemo: true,
    role: 'owner',
  };

  const forecast = {
    asOfDate: '2026-11-28',
    openingCashPaise: 42_500_000,
    minimumReservePaise: 15_000_000,
    horizonDays: 90,
    daily: [
      { date: '2026-11-28', closingCashPaise: 42_500_000, receiptsPaise: 0, paymentsPaise: 0, events: [] },
      { date: '2026-11-29', closingCashPaise: 42_500_000, receiptsPaise: 0, paymentsPaise: 0, events: [] },
    ],
    risk: {
      firstNegativeDate: null,
      firstReserveBreachDate: null,
      worstCashPaise: 42_500_000,
      worstDate: '2026-11-28',
      contributingItems: [],
      explanation: 'Projected cash stays above the reserve.',
    },
    warnings: [],
    promiseRisks: [],
    cashDesk: {
      snapshotDate: '2026-11-28',
      safeToSpendPaise: 27_500_000,
      dataFreshness: { lastUpdatedAt: '2026-11-28T00:00:00.000Z', staleDays: 0, stale: false, lastSuccessfulSyncAt: '2026-11-28T00:00:00.000Z' },
      unresolvedIssues: { totalCount: 0, bankRows: [], cashItems: [] },
    },
  };

  const fetchMock = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (url.endsWith('/workspaces') && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ workspaces: [] }) };
    }
    if (url.endsWith('/workspaces/demo') && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ workspace: demoWorkspace, created: true, reset: false }) };
    }
    if (url.includes('/forecast')) {
      return { ok: true, status: 200, json: async () => forecast };
    }
    if (url.includes('/promises')) {
      return { ok: true, status: 200, json: async () => ({ asOfDate: '2026-11-28', items: [] }) };
    }
    if (url.includes('/spending-check')) {
      const confirmed = new URL(url, 'http://localhost').searchParams.get('commitmentsConfirmed') === 'true';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: confirmed ? 'conditional' : 'incomplete',
          asOfDate: '2026-11-28',
          evaluatedOn: '2026-11-28',
          horizonDays: 30,
          endDate: '2026-12-27',
          delayDays: 7,
          spendPaise: 0,
          openingCashPaise: 42_500_000,
          minimumReservePaise: 15_000_000,
          expected: {
            spendablePaise: confirmed ? 27_500_000 : null,
            minimumBalancePaise: 42_500_000,
            minimumDate: '2026-11-28',
            reserveGapPaise: 0,
            firstReserveBreachDate: null,
            canSpend: confirmed ? true : null,
            afterSpendMinimumPaise: 42_500_000,
            includedReceiptsPaise: 0,
            includedPaymentsPaise: 0,
          },
          delayed: {
            spendablePaise: confirmed ? 27_500_000 : null,
            minimumBalancePaise: 42_500_000,
            minimumDate: '2026-11-28',
            reserveGapPaise: 0,
            firstReserveBreachDate: null,
            canSpend: confirmed ? true : null,
            afterSpendMinimumPaise: 42_500_000,
            includedReceiptsPaise: 0,
            includedPaymentsPaise: 0,
          },
          recommendedSpendablePaise: confirmed ? 27_500_000 : null,
          dataQuality: { complete: confirmed, issues: confirmed ? [] : [{ code: 'CONFIRM_COMMITMENTS', blocking: true, amountPaise: 0, message: 'Confirm' }] },
          assumptions: ['Calculated from daily closing cash.'],
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<BusinessApp user={{ id: 'user-1', name: 'Ananya', email: 'ananya@example.com' }} onLogout={() => {}} />);

  const selector = await screen.findByLabelText('Supplier profile');
  expect(screen.getByRole('option', { name: 'Try our demo' })).toBeTruthy();

  fireEvent.change(selector, { target: { value: '__try_demo__' } });

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith('/workspaces/demo') && init?.method === 'POST')).toBe(true);
  });

  await screen.findByText(/Limit that preserves the reserve in both scenarios/);
  expect(screen.queryByText('Unavailable')).toBeNull();

  const resetBtn = screen.getByRole('button', { name: 'Reset demo data' });
  fireEvent.click(resetBtn);
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith('/workspaces/demo') && init?.body === JSON.stringify({ reset: true }))).toBe(true);
  });
});
