import { describe, expect, it } from 'vitest';
import { buildForecast } from '../src/services/finance/forecast.js';

describe('finance forecast contract', () => {
  it('uses only open future amounts and exposes the fixture shortage', () => {
    const forecast = buildForecast({
      asOfDate: '2026-11-01', openingCashPaise: 20_000_000, cashItems: [
        { id: 'paid', category: 'receivable', amountPaise: 10_000_000, settledPaise: 10_000_000, status: 'paid', expectedDate: '2026-10-20' },
        { id: 'bill', externalId: 'BILL-P200', category: 'payable', amountPaise: 30_000_000, status: 'open', expectedDate: '2026-11-06' },
        { id: 'payroll', category: 'expense', amountPaise: 10_000_000, status: 'open', expectedDate: '2026-11-11' },
        { id: 'invoice', category: 'receivable', amountPaise: 50_000_000, settledPaise: 10_000_000, status: 'partial', expectedDate: '2026-11-26' },
      ],
    });
    expect(forecast.daily).toHaveLength(90);
    expect(forecast.daily[0].closingCashPaise).toBe(20_000_000);
    expect(forecast.risk.firstNegativeDate).toBe('2026-11-06');
    expect(forecast.risk.worstCashPaise).toBe(-20_000_000);
    expect(forecast.daily.find(day => day.date === '2026-11-26').closingCashPaise).toBe(20_000_000);
    expect(forecast.risk.contributingItems[0].externalId).toBe('BILL-P200');
  });

  it('keeps reserve breaches distinct and flags unscheduled overdue items', () => {
    const forecast = buildForecast({ asOfDate: '2026-11-01', horizonDays: 7,
      openingCashPaise: 20_000_000, minimumReservePaise: 10_000_000, cashItems: [
        { id: 'bill', category: 'payable', amountPaise: 15_000_000, expectedDate: '2026-11-05' },
        { id: 'overdue', category: 'receivable', amountPaise: 50_000_000, dueDate: '2026-10-20' },
      ] });
    expect(forecast.risk.firstNegativeDate).toBeNull();
    expect(forecast.risk.firstReserveBreachDate).toBe('2026-11-05');
    expect(forecast.warnings).toHaveLength(1);
  });
});
