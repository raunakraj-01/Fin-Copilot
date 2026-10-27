import { readFileSync } from 'node:fs';

export function fixtureContext() {
  const root = new URL('../../fixtures/', import.meta.url);
  function rows(name) {
    const [header, ...records] = readFileSync(new URL(name, root), 'utf8').trim().split(/\r?\n/);
    const keys = header.split(',');
    return records.map(record => Object.fromEntries(record.split(',').map((value, index) => [keys[index], value])));
  }
  const receivables = rows('receivables.csv').map(row => ({
    id: row['Invoice ID'], externalId: row['Invoice ID'], category: 'receivable',
    amountPaise: Number(row['Amount INR']) * 100, settledPaise: Number(row['Settled INR']) * 100,
    dueDate: row['Due Date'], expectedDate: row['Expected Date'], status: row.Status,
    constraints: { earliestCollectionDate: row['Earliest Collection Date'], maxEarlyCollectionPaise: Number(row['Max Early Collection INR']) * 100, estimatedActionCostPaise: row['Estimated Action Cost INR'] ? Number(row['Estimated Action Cost INR']) * 100 : null },
  }));
  const payables = rows('payables.csv').map(row => ({
    id: row['Bill ID'], externalId: row['Bill ID'], category: 'payable',
    amountPaise: Number(row['Amount INR']) * 100, settledPaise: Number(row['Settled INR']) * 100,
    dueDate: row['Due Date'], expectedDate: row['Expected Date'], status: row.Status,
    constraints: { mandatory: row.Mandatory === 'yes', negotiable: row.Negotiable === 'yes', discretionary: row.Discretionary === 'yes', maxExtensionDays: Number(row['Max Extension Days']), estimatedActionCostPaise: row['Estimated Action Cost INR'] ? Number(row['Estimated Action Cost INR']) * 100 : null },
  }));
  return { asOfDate: '2026-11-01', horizonDays: 90, openingCashPaise: 20_000_000, minimumReservePaise: 0, cashItems: [...receivables, ...payables], recurringRules: [] };
}
export const isolatedContext = () => ({ asOfDate: '2026-11-01', horizonDays: 90, openingCashPaise: 20_000_000, minimumReservePaise: 10_000_000, cashItems: [], recurringRules: [] });
export const draftOrder = () => ({ label: 'Synthetic order', orderValuePaise: 80_000_000, advancePaise: 0, advanceDate: '2026-11-02', finalCollectionDate: '2026-12-31', costLines: [{ description: 'Materials', amountPaise: 50_000_000, paymentDate: '2026-11-11' }], delayedCollectionDays: 14 });
