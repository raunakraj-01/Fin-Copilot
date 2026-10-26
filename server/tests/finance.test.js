import { describe, expect, it } from 'vitest';
import { buildForecast } from '../src/services/finance/forecast.js';

describe('finance forecast contract', () => {
  it('uses only open future amounts and exposes the fixture shortage', () => {
    const forecast = buildForecast({
      asOfDate: '2026-11-01', openingCashPaise: 20_000_000, cashItems: [
        { id: 'paid', category: 'receivable', amountPaise: 10_000_000, settledPaise: 10_000_000, status: 'paid', expectedDate: '2026-10-20' },
        { id: 'bill', externalId: 'BILL-P200', category: 'payable', amountPaise: 30_000_000, status: 'open', expectedDate: '2026-11-06' },
        { id: 'payroll', category: 'expense', amountPaise: 10_000_000, status: 'open', expectedDate: '2026-11-11' },
        { id: 'invoice', externalId: 'INV-R100', category: 'receivable', amountPaise: 50_000_000, settledPaise: 10_000_000, status: 'partial', expectedDate: '2026-11-26' },
      ],
    });
    expect(forecast.daily).toHaveLength(90);
    expect(forecast.daily[0].closingCashPaise).toBe(20_000_000);
    expect(forecast.risk.firstNegativeDate).toBe('2026-11-06');
    expect(forecast.risk.worstCashPaise).toBe(-20_000_000);
    expect(forecast.daily.find(day => day.date === '2026-11-26').closingCashPaise).toBe(20_000_000);
    expect(forecast.risk.contributingItems[0].externalId).toBe('BILL-P200');
    expect(forecast.risk.explanation).toContain('BILL-P200');
    expect(forecast.risk.explanation).toContain('INV-R100');
  });

  it('keeps reserve breaches distinct and flags unscheduled overdue items', () => {
    const forecast = buildForecast({ asOfDate: '2026-11-01', horizonDays: 7,
      openingCashPaise: 20_000_000, minimumReservePaise: 10_000_000, cashItems: [
        { id: 'bill', category: 'payable', amountPaise: 15_000_000, expectedDate: '2026-11-05' },
        { id: 'overdue', category: 'receivable', amountPaise: 50_000_000, dueDate: '2026-10-20' },
      ] });
    expect(forecast.risk.firstNegativeDate).toBeNull();
    expect(forecast.risk.firstReserveBreachDate).toBe('2026-11-05');
    expect(forecast.risk.explanation).toContain('minimum reserve');
    expect(forecast.warnings).toHaveLength(1);
  });

  it('expands monthly expenses once per month', () => {
    const forecast = buildForecast({ asOfDate: '2026-11-01', horizonDays: 75, openingCashPaise: 10_000_000,
      recurringRules: [{ id: 'rent', description: 'Rent', amountPaise: 2_500_000,
        dayOfMonth: 5, startsOn: '2026-11-01', active: true }] });
    expect(forecast.daily.filter(day => day.paymentsPaise > 0).map(day => day.date))
      .toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
  });

  it('does not add an as-of-date cash item into the opening snapshot', () => {
    const forecast = buildForecast({ asOfDate: '2026-11-01', horizonDays: 2,
      openingCashPaise: 20_000_000, cashItems: [
        { id: 'old', category: 'receivable', amountPaise: 10_000_000, status: 'open', expectedDate: '2026-11-01' },
      ] });
    expect(forecast.daily[0].closingCashPaise).toBe(20_000_000);
    expect(forecast.warnings).toHaveLength(1);
  });
});
