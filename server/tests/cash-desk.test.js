import { expect, it } from 'vitest';
import { cashDeskSummary, indiaDate } from '../src/services/finance/cashDesk.js';
import { workspaceCreate, workspacePatch } from '../src/validators/finance.js';
import { todayIndia } from '../src/utils/dates.js';
import { createDecisionContextLoader } from '../src/services/rescue/decisionContext.js';

it('uses the Indian calendar date across the UTC day boundary', () => {
  expect(indiaDate(new Date('2026-11-20T20:00:00.000Z'))).toBe('2026-11-21');
});

it('defaults API-created workspaces to today in India when no date is supplied', () => {
  expect(workspaceCreate.parse({ name: 'New supplier', openingCashPaise: 0 }).asOfDate).toBe(todayIndia());
  expect(workspacePatch.parse({ minimumReservePaise: 100 })).toEqual({ minimumReservePaise: 100 });
});

it('loads sync and import freshness from the same business scope as cash records', async () => {
  const scopedWorkspace = 'workspace-1';
  const latestRecord = value => ({ sort: () => ({ lean: async () => value }) });
  const loader = createDecisionContextLoader({
    Workspace: { findById: () => ({ lean: async () => ({ asOfDate: '2026-11-21', openingCashPaise: 10000,
      updatedAt: new Date('2026-11-18T00:00:00.000Z') }) }) },
    CashItem: { find: query => { expect(query).toEqual({ workspaceId: scopedWorkspace }); return { lean: async () => [] }; } },
    RecurringRule: { find: query => { expect(query).toEqual({ workspaceId: scopedWorkspace, active: true }); return { lean: async () => [] }; } },
    BankTransaction: { find: query => { expect(query).toEqual({ workspaceId: scopedWorkspace, reviewState: 'open' }); return { lean: async () => [] }; } },
    SyncBatch: { findOne: query => { expect(query).toEqual({ workspaceId: scopedWorkspace }); return latestRecord({ createdAt: new Date('2026-11-20T00:00:00.000Z') }); } },
    ImportBatch: { findOne: query => { expect(query).toEqual({ workspaceId: scopedWorkspace, status: 'committed' }); return latestRecord({ updatedAt: new Date('2026-11-19T00:00:00.000Z') }); } },
  });
  const context = await loader(scopedWorkspace);
  expect(context).toMatchObject({ lastSuccessfulSyncAt: '2026-11-20T00:00:00.000Z',
    lastImportAt: '2026-11-19T00:00:00.000Z', latestInputAt: '2026-11-20T00:00:00.000Z' });
});

it('reports reserve-aware spend headroom, data issues, and source freshness', () => {
  const context = {
    asOfDate: '2026-11-21', minimumReservePaise: 3000,
    latestInputAt: '2026-11-20T10:00:00.000Z', lastSuccessfulSyncAt: '2026-11-20T09:00:00.000Z',
    lastImportAt: '2026-11-19T09:00:00.000Z',
    cashItems: [
      { id: 'needs-review', status: 'open', confidenceState: 'needs_review', amountPaise: 5000, settledPaise: 500 },
      { id: 'missing-date', status: 'partial', confidenceState: 'owner_assumption', amountPaise: 4000, settledPaise: 1000 },
      { id: 'settled', status: 'paid', confidenceState: 'needs_review', amountPaise: 1000, settledPaise: 1000 },
    ],
    bankReviewIssues: [{ transactionId: 'bank-row', amountPaise: 2500 }],
  };
  const forecast = { openingCashPaise: 10000, minimumReservePaise: 3000,
    daily: [{ closingCashPaise: 10000 }, { closingCashPaise: 7500 }, { closingCashPaise: 8000 }] };

  expect(cashDeskSummary(context, forecast, new Date('2026-11-21T07:00:00.000Z'))).toEqual({
    snapshotDate: '2026-11-21', safeToSpendPaise: 4500,
    dataFreshness: { lastUpdatedAt: '2026-11-20T10:00:00.000Z', staleDays: 1, stale: false,
      lastSuccessfulSyncAt: '2026-11-20T09:00:00.000Z', lastImportAt: '2026-11-19T09:00:00.000Z' },
    unresolvedIssues: {
      totalCount: 3,
      bankRows: [{ transactionId: 'bank-row', amountPaise: 2500 }],
      cashItems: [
        { cashItemId: 'needs-review', externalId: '', counterparty: '', amountPaise: 4500, reason: 'verification' },
        { cashItemId: 'missing-date', externalId: '', counterparty: '', amountPaise: 3000, reason: 'expected_date' },
      ],
    },
  });
});

it('marks source data stale after seven days without treating future updates as stale', () => {
  const forecast = { openingCashPaise: 0, minimumReservePaise: 0, daily: [] };
  const base = { asOfDate: '2026-11-10', minimumReservePaise: 0, cashItems: [], bankReviewIssues: [] };
  expect(cashDeskSummary({ ...base, latestInputAt: '2026-11-10T00:00:00.000Z' }, forecast,
    new Date('2026-11-21T07:00:00.000Z')).dataFreshness).toMatchObject({ staleDays: 11, stale: true });
  expect(cashDeskSummary({ ...base, latestInputAt: '2026-11-22T00:00:00.000Z' }, forecast,
    new Date('2026-11-21T07:00:00.000Z')).dataFreshness).toMatchObject({ staleDays: 0, stale: false });
});
