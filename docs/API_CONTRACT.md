# CashFlow Copilot — REST API Contract (MVP)

Base URL: `http://localhost:5000/api`. Data format: JSON except multipart file inspection. Monetary fields are **integer paise**. Business dates are `YYYY-MM-DD` India business dates. Errors must be structured; never return HTTP 200 with hidden validation failure.

## 1. Workspace

### `POST /api/workspaces`

```json
{"name":"Demo Packaging Supplier","asOfDate":"2026-11-01","openingCashPaise":20000000,"minimumReservePaise":0}
```

Returns `201 { "workspace": { "id": "...", "name": "...", "asOfDate": "...", "openingCashPaise": 20000000, "minimumReservePaise": 0 } }`.

- `GET /api/workspaces/:workspaceId` -> current workspace snapshot.
- `PATCH /api/workspaces/:workspaceId` -> update editable cash snapshot, date, reserve; reject negative reserves and invalid dates.
- `GET /api/health` -> `{ "ok": true }`.

## 2. Import pipeline

1. `POST /api/workspaces/:workspaceId/imports/inspect` multipart `file` and `kind` (`receivables` | `payables`). Returns `batchId`, headers, 5 sampled rows and auto-suggested mapping. **No cash items committed yet.**
2. `POST /api/workspaces/:workspaceId/imports/:batchId/validate` with `mapping` and optional `sourceSystem`. Returns normalized preview rows, warnings and blocking errors. Suggested mappings are editable.
3. `POST /api/workspaces/:workspaceId/imports/:batchId/commit` with `corrections` and `excludedRowNumbers`. Requires all committed records be valid; returns saved count, skipped count, duplicate conflicts. **Idempotent**: repeated commit must not duplicate records.

Supported canonical mapping keys: `externalId`, `counterparty`, `amountInr`, `settledInr`, `dueDate`, `expectedDate`, `status`, `mandatory`, `negotiable`, `discretionary`, `maxExtensionDays`, `earliestCollectionDate`, `maxEarlyCollectionInr`, `estimatedActionCostInr`.

At least `externalId` (or mark as manual-review), `counterparty`, `amountInr`, `dueDate`, and `expectedDate` are required to approve a forecasted open item. Payables can default `expectedDate` to due date **only if displayed as an explicit assumption and approved by the owner**. A `paid` row has zero outstanding, never a new forecast inflow/outflow.

For 3-day deadline, if a full inspect/validate/commit pipeline threatens core delivery, implement a **single preview-and-commit UI using standard fixture headers**, with corrections and reject-before-save; document the simplification. Do not blindly insert files without review.

## 3. Financial items

- `GET /api/workspaces/:workspaceId/items?category=receivable&status=open` -> approved items with computed `outstandingPaise`.
- `POST /api/workspaces/:workspaceId/items` -> manually add one validated item.
- `PATCH /api/workspaces/:workspaceId/items/:itemId` -> correct expected date, status, constraints or amount (validate settled <= amount).
- `DELETE /api/workspaces/:workspaceId/items/:itemId` -> demo-only delete with confirmation; historical audit is future work.
- `GET/POST /api/workspaces/:workspaceId/recurring-rules` -> optional rule list and new monthly cost.

## 4. Daily forecast

### `GET /api/workspaces/:workspaceId/forecast?horizonDays=90`

```json
{
  "asOfDate":"2026-11-01",
  "openingCashPaise":20000000,
  "minimumReservePaise":0,
  "horizonDays":90,
  "daily":[{"date":"2026-11-01","receiptsPaise":0,"paymentsPaise":0,"closingCashPaise":20000000}],
  "risk":{
    "firstNegativeDate":"2026-11-06",
    "firstReserveBreachDate":"2026-11-06",
    "worstCashPaise":-20000000,
    "worstDate":"2026-11-11",
    "peakShortagePaise":20000000,
    "contributingItems":[{"cashItemId":"...","externalId":"BILL-200","amountPaise":30000000,"date":"2026-11-06","direction":"out"}]
  },
  "warnings":["Some records require verification"],
  "assumptions":["Expected dates are user inputs, not guaranteed collection dates"]
}
```

The `daily` array in real responses includes **every day** in the horizon; the one-point snippet is illustrative. `firstNegativeDate` and `firstReserveBreachDate` may be `null`. Risk attribution should be traceable to source event IDs, not fabricated AI narrative.

## 5. Automatic Rescue Planner

### `POST /api/workspaces/:workspaceId/rescue/analyze`

```json
{"objective":"nonnegative","maxCandidates":12,"maxPlans":3}
```

Returns:

```json
{
  "baseline":{"worstCashPaise":-20000000,"firstNegativeDate":"2026-11-06"},
  "objective":"nonnegative",
  "candidateCount":1,
  "plans":[],
  "partialMitigations":[{
    "planId":"simulation-1",
    "fullyFeasible":false,
    "feasibility":"insufficient",
    "worstCashPaiseAfter":-300000,
    "knownActionCostPaise":300000,
    "containsUnknownCosts":false,
    "actions":[{
      "cashItemId":"...","externalId":"INV-R100",
      "type":"accelerate_collection","amountPaise":20000000,
      "fromDate":"2026-11-26","toDate":"2026-11-04",
      "estimatedCostPaise":300000,"feeDate":"2026-11-04","requiresAgreement":true
    }],
    "daily":[],
    "warnings":["Plan works only if agreed actions happen on assumed dates"]
  }],
  "message":"No feasible plan found under entered constraints among the tested combinations across the full horizon"
}
```

This abbreviated example permits only early collection. The bundled fixture also permits supplier deferral and therefore returns other complete plans. `plans` is empty if none fully satisfies the objective; return clear `message` and partial mitigations instead. A plan is only `fullyFeasible` if **every** forecast day meets the selected objective after known dated fees. Unknown fees are excluded and may change feasibility; do not claim a globally cheapest plan. `constraints.actionCostDate` overrides the fee date; otherwise the proposed action date is explicitly assumed. Positive known fees must lie after the snapshot and within the forecast horizon.

### `POST /api/workspaces/:workspaceId/rescue/plans`

Save a user-selected plan/actions, but preserve base items untouched. Stretch: `PATCH /api/workspaces/:workspaceId/rescue/plans/:planId/actions/:actionId` to update requested/agreed/rejected/completed and owner note.

## 6. New Order Impact Analyzer

### `POST /api/workspaces/:workspaceId/orders/analyze`

```json
{
  "label":"Prospective order",
  "orderValuePaise":80000000,
  "advancePaise":0,
  "advanceDate":"2026-11-02",
  "finalCollectionDate":"2026-12-31",
  "costLines":[{"description":"Raw material","amountPaise":50000000,"paymentDate":"2026-11-11"}],
  "delayedCollectionDays":14
}
```

Returns:

```json
{
  "baseline":{"worstCashPaise":-20000000},
  "withOrder":{"worstCashPaise":-70000000,"firstReserveBreachDate":"2026-11-06","daily":[]},
  "minimumAdvance":{"possible":true,"amountPaise":70000000,"conditionalOnAssumptions":true},
  "delayedCustomerScenario":{"daily":[]},
  "warnings":["Business already had a shortage before this proposed order"]
}
```

**Illustration assumes the bundled demo workspace, zero cash reserve, and that material cost is paid on Nov 11. The engine must compute actual output from saved workspace data.** No predefined figures or mock “minimum advance” values in the running API. `minimumAdvance.possible=false` with an explanatory message if even the full order advance is insufficient, or if needed cash comes before the advance date.

`POST /api/workspaces/:workspaceId/orders/scenarios` can optionally save a result as **hypothetical**; it must not become posted sales or bank cash.

## 7. Errors and limits

- `400 VALIDATION_ERROR`: invalid date, negative money, inconsistent settlement, action outside constraint.
- `404 NOT_FOUND`: workspace, item or batch missing.
- `409 DUPLICATE_RECORD`: duplicate external source identifier or repeated import.
- `413 UPLOAD_TOO_LARGE`: >2 MB.
- `422 NEEDS_REVIEW`: attempt to commit critical invalid imported rows.
- `500 INTERNAL_ERROR`: safe message; stack/details logged server-side only.

Common error shape:

```json
{"error":{"code":"VALIDATION_ERROR","message":"expectedDate must be a valid YYYY-MM-DD date","details":[{"field":"expectedDate"}]}}
```

Configure CORS for local client origin and prevent unrestricted file upload sizes. Demo workspace ID is **not** security/authentication.
