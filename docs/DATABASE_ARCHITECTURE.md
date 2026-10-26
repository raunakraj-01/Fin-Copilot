# CashFlow Copilot — MongoDB Database Architecture

> Database: **MongoDB**. ODM: **Mongoose**. Compass is used for viewing/inspecting the data, not as the database server. MVP is **one clearly labeled demo workspace**, not a production multi-tenant service.

## 1. Collections and relationships

```text
Workspace (1)
  |--- (N) CashItem              # customer invoices, supplier bills, expenses
  |--- (N) RecurringRule         # future monthly costs, if configured
  |--- (N) ImportBatch           # source file metadata, draft preview, review errors
  |--- (N) RescuePlan            # snapshots of proposed/planned interventions
  |--- (N) OrderScenario         # hypothetical customer order analysis

CashItem.importBatchId --> ImportBatch._id (optional)
RescuePlan.actions[*].cashItemId --> CashItem._id
Forecast --> DERIVED response, computed on demand. No Forecast collection necessary for MVP.
```

Every persisted business collection includes `workspaceId`. Do not expose arbitrary workspace IDs as authorization in a production deployment; single-workspace demo mode is deliberately non-production.

## 2. Shared conventions

- Monetary values: **integer paise**, named `*Paise` (e.g. `40000000` = ₹4,00,000). In API forms show Indian rupees and convert to paise on input.
- Date-only business fields: `YYYY-MM-DD` strings; validated calendar dates; interpreted as Asia/Kolkata business dates. `createdAt`, `updatedAt` are MongoDB UTC timestamps.
- Use enum validation on status/category/action types and strict schema validation. Disallow negative `amountPaise` and `settledPaise > amountPaise`.
- Use `sourceSystem` + `externalId` (and workspace/category) to detect duplicates, but when external IDs are missing, flag duplicates as **possible** rather than deleting records.
- `confidenceState`: `verified` | `owner_assumption` | `needs_review`. Do **not** assign fictitious numerical ML confidence percentages.
- Prefer indexes on `(workspaceId, expectedDate)`, `(workspaceId, category, status)`, and conditional `(workspaceId, category, sourceSystem, externalId)` uniqueness for non-empty external IDs. Handle collision as a review issue.

## 3. Workspace

```js
{
  _id: ObjectId,
  name: 'Demo Packaging Supplier',
  asOfDate: '2026-11-01',
  openingCashPaise: 20000000,          // ₹2,00,000
  minimumReservePaise: 0,            // adjustable cash safety threshold
  currency: 'INR',
  mode: 'demo',
  createdAt: Date,
  updatedAt: Date
}
```

**Rule:** Opening cash includes already-completed historical transactions through `asOfDate`. Don't add historical bank transactions to it again.

## 4. CashItem — one collection, three categories

```js
{
  _id: ObjectId,
  workspaceId: ObjectId,
  category: 'receivable',            // 'receivable' | 'payable' | 'expense'
  externalId: 'INV-R100',
  counterparty: 'Acme Retail Pvt Ltd',
  description: 'Corrugated boxes',
  sourceSystem: 'tally_export',       // 'tally_export' | 'excel' | 'manual' | 'csv'
  importBatchId: ObjectId | null,
  amountPaise: 40000000,            // original gross amount due under this record
  settledPaise: 0,                  // already received/paid; NOT forecast again
  status: 'open',                   // 'open' | 'partial' | 'paid' | 'cancelled'
  dueDate: '2026-11-15',
  expectedDate: '2026-11-26',        // verified/explicit expected cash movement date
  confidenceState: 'owner_assumption',
  constraints: {
    mandatory: false,              // primarily payables/expenses
    negotiable: true,              // payable can be shifted only if true
    maxExtensionDays: 20,          // supplier bill: latest allowed hypothetical extension
    earliestCollectionDate: '2026-11-04', // receivables only, if owner permits testing
    maxEarlyCollectionPaise: 20000000,    // cap <= outstanding
    discretionary: false,          // expenses only
    estimatedActionCostPaise: null // null = unknown; NOT zero-cost
  },
  reviewIssues: [],
  notes: '',
  createdAt: Date,
  updatedAt: Date
}
```

**Derived outstanding** `max(0, amountPaise - settledPaise)`. Do not persist a second writable outstanding value. Validate status against settlement, and exclude `paid`/`cancelled` from forecast.

**Category rules:**
- `receivable`: customer money **in**; can be accelerated at most up to outstanding and not before earliest allowed collection date.
- `payable`: money **out**; can move later only with `negotiable === true` and within `maxExtensionDays`.
- `expense`: money **out**; can postpone only when `discretionary === true` (mandatory/payroll cannot be postponed).
- If `dueDate < asOfDate` and `expectedDate` is missing or earlier than `asOfDate`, mark `needs_review`; don't auto-count as immediate incoming cash.

## 5. RecurringRule (small optional P0/P1)

```js
{
  _id: ObjectId,
  workspaceId: ObjectId,
  description: 'Monthly rent',
  amountPaise: 5000000,
  dayOfMonth: 5,              // restrict to 1..28 for simplicity
  startsOn: '2026-11-01',
  endsOn: null,
  mandatory: true,
  active: true,
  createdAt: Date,
  updatedAt: Date
}
```

Expand into dated events **at forecast time** only. Do not insert expanded recurring events into `CashItem` unless you also implement deduplication between generated and manually entered expense instances.

## 6. ImportBatch

```js
{
  _id: ObjectId,
  workspaceId: ObjectId,
  fileName: 'receivables.xlsx',
  fileType: 'xlsx',
  kind: 'receivables',        // 'receivables' | 'payables'
  sourceSystem: 'excel',
  status: 'inspected',       // 'inspected' | 'validated' | 'committed' | 'failed'
  headers: ['Invoice', 'Customer', 'Balance', 'Expected Date'],
  rawRows: [],               // limit to small student demo imports, e.g. <=500 rows
  mapping: {},
  rowIssues: [],             // [{rowNumber, field, code, message, severity}]
  counts: {accepted: 0, needsReview: 0, rejected: 0, committed: 0},
  createdAt: Date,
  updatedAt: Date
}
```

**Safety/size:** Max 2 MB, max 500 data rows per file for MVP. Do not persist raw uploaded PDF/bank documents or unlimited confidential text. Implement preview -> validate/correct -> commit; never commit rows with blocking errors.

## 7. RescuePlan

```js
{
  _id: ObjectId,
  workspaceId: ObjectId,
  asOfDate: '2026-11-01',
  objective: 'nonnegative',     // 'nonnegative' | 'minimum_reserve'
  status: 'proposed',          // 'proposed' | 'in_progress' | 'completed' | 'abandoned'
  baselineWorstCashPaise: -20000000,
  simulatedWorstCashPaise: 0,
  estimatedTotalCostPaise: null,      // null if ANY costs are unknown
  containsUnknownCosts: true,
  feasibility: 'conditional',       // 'conditional' | 'insufficient'
  actions: [
    {
      actionId: 'action-1',
      cashItemId: ObjectId,
      type: 'accelerate_collection', // 'accelerate_collection' | 'defer_payable' | 'delay_expense'
      amountPaise: 20000000,
      fromDate: '2026-11-26',
      toDate: '2026-11-04',
      estimatedCostPaise: null,
      status: 'proposed',           // 'proposed'|'requested'|'agreed'|'rejected'|'completed'
      ownerNotes: ''
    }
  ],
  planWarnings: ['Requires buyer agreement'],
  createdAt: Date,
  updatedAt: Date
}
```

**Planning/actuality separation:** Saving a plan or changing action status never directly updates `CashItem.settledPaise`. Forecasting an agreed date adjustment should be deliberate and tagged an assumption. Actual settlement must be explicitly reflected in current cash snapshot and open balance before next forecast.

## 8. OrderScenario (hypothetical; never posts accounting entries)

```js
{
  _id: ObjectId,
  workspaceId: ObjectId,
  label: 'Prospective retail order',
  orderValuePaise: 80000000,
  advancePaise: 0,
  advanceDate: '2026-11-02',
  finalCollectionDate: '2026-12-31',
  costLines: [
    { description: 'Materials', amountPaise: 50000000, paymentDate: '2026-11-11' }
  ],
  simulatedMinimumAdvancePaise: 40000000,   // only under explicitly stated baseline and assumptions
  scenarioWarnings: [],
  createdAt: Date,
  updatedAt: Date
}
```

For any tested advance `A`, simulate receipt `A` on the advance date and remaining receipt `orderValuePaise - A` on the final date. The order **cannot** create `orderValuePaise + A` of cash. The calculated minimum advance is conditional on baseline forecast, horizon, date sequence, and the modeled costs.

## 9. Database index guidance

```js
cashItemSchema.index({ workspaceId: 1, expectedDate: 1 });
cashItemSchema.index({ workspaceId: 1, category: 1, status: 1 });
// Only enforce when externalId/sourceSystem are present and normalized.
cashItemSchema.index(
  { workspaceId: 1, category: 1, sourceSystem: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } }
);
importBatchSchema.index({ workspaceId: 1, createdAt: -1 });
rescuePlanSchema.index({ workspaceId: 1, createdAt: -1 });
```

## 10. Persistence limits and migration

- In the MVP, derive forecast output on demand rather than store stale daily arrays; store saved rescue plans/order scenarios only when requested.
- A future commercial version will need explicit user accounts, memberships, authorization, immutable financial audit trail, import versioning, source document protection, and multi-tenant access tests.
- Schema names in code should match this document unless a clearly justified simplification is documented in the README.
