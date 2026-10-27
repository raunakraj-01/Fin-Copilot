# Person 2 delivery and integration

## Implemented scope

- Automatic rescue candidate generation from open receivables, negotiable payables and discretionary expenses, with a maximum of 12 candidates and 3 returned plans.
- Immutable collection splitting and payment deferral; full-horizon evaluation through the injected shared `buildForecast` function; conditional plans, explicit unknown costs, and partial mitigations.
- New-order scenarios with multiple dated costs, delayed customer payment, exact integer-paise minimum advance search, existing-versus-new shortages, and out-of-horizon warnings.
- Default-exported Express routers and React pages. Both production routers resolve the same `server/src/services/finance/forecast.js` export through `loadSharedForecast`.
- Zod request validation, structured 400/404/500 responses, scoped read-only model loading, and testable dependency factories.
- Recharts comparisons, every-day tables, INR input/display, loading/errors/empty states, and stale-request cancellation.
- `POST /rescue/plans` and a Save proposed plan control. The server revalidates actions against current workspace data and recomputes balances and costs before writing a `RescuePlan`; it does not change cash items.

Optional save-scenario and action-tracking endpoints are not implemented.

## Verification and its limits

The isolated verification suite covers engines, HTTP routes, model-read scoping, and UI behavior. It uses the explicitly named `server/tests/rescueForecastStub.mjs` for most checks and also runs focused checks against the real shared forecast. The stub is never imported into production source.

The test suite uses the original CSV fixture files, including the four-lakh isolated advance and seven-lakh advance against the bundled shortage baseline. It checks one-paise/one-rupee boundaries, partial settlements, duplicate actions, mandatory bills, unknown costs, recurring obligations, deferral reappearance, late advances, delayed receipts, malformed inputs, all-day safety and immutability.

A production-mode React bundle is also built by the verification script. A temporary synthetic preview can exercise the pages and API together without MongoDB. Neither that preview nor these isolated tests proves compatibility with Person 1's actual forecast implementation or database. The real shared-module smoke check and MongoDB application checks must run after integration.

## Run independently now

From the repository root:

```sh
node server/tests/rescue-verify.mjs
node server/tests/rescue-verify.mjs --preview
```

The script copies Person 2 modules and fixtures into a newly printed temporary directory, installs pinned verification dependencies there, runs Vitest, and bundles the preview. It does not create or edit any shared repository package file. It requires Node, npm and registry access; verified on Node 25.9.0. The first install may take time.

With `--preview`, open `http://127.0.0.1:5174`. The banner explicitly says synthetic preview, test forecast, and no database. It offers the bundled CSV shortage workspace and the isolated order workspace. Stop with Ctrl+C. Override the local port with `PERSON2_PREVIEW_PORT` if needed.

Isolated example: choose Order analyzer and Isolated order example; enter order value `8,00,000`, advance `0`, advance date `2026-11-02`, final date `2026-12-31`, material payment `5,00,000` on `2026-11-11`. Expected minimum advance is `4,00,000` rupees, based on the test forecast.

## Files to integrate

```text
server/src/routes/rescue.js
server/src/routes/orders.js
server/src/controllers/rescueDecisionHandler.js
server/src/services/rescue/analyze.js
server/src/services/rescue/dates.js
server/src/services/rescue/validation.js
server/src/services/rescue/savePlan.js
server/src/services/rescue/decisionContext.js
server/src/services/rescue/INTEGRATION.md
server/src/services/orders/analyze.js
client/src/pages/RescuePlanner.jsx
client/src/pages/RescuePlanner/DecisionUI.jsx
client/src/pages/RescuePlanner/decision.css
client/src/pages/OrderAnalyzer.jsx
client/src/pages/OrderAnalyzer/money.js
server/tests/rescue* and server/tests/orders*
```

No shared application, package, schema, original specification, fixture or shared style file was edited. New styles are scoped under `.decision-page` and live within the Person 2 feature directory.

## Requests for Person 1

Please add and commit the dependencies in the shared package files you own:

- Server: Express (already specified) and Zod 4.
- Client: React/React DOM (already specified) and Recharts 3.
- Verification: Vitest, Supertest; UI checks additionally use jsdom and React Testing Library. The isolated script already provides these without changing your package layout.

The isolated harness pins the exact versions it tested. Integrate with the team's package choices, then rerun the checks rather than treating the temporary dependency graph as the final app lockfile.

### Shared forecast and models

Provide the agreed pure `buildForecast({ asOfDate, horizonDays, openingCashPaise, minimumReservePaise, cashItems, recurringRules, additionalEvents })` export in `server/src/services/finance/forecast.js`.

`decisionContext.js` currently expects default exports at:

```text
server/src/models/Workspace.js
server/src/models/CashItem.js
server/src/models/RecurringRule.js
```

These filenames and exports match the merged finance skeleton. The adapter queries cash items by workspace and active recurring rules by workspace. Plan saving writes only through `RescuePlan.create`; preserve IDs, partial settlements, confidence states, expected dates and constraints.

The context supports both nested `constraints` and the frozen flattened optional constraint fields. If both exist, a defined flattened field takes precedence.

### Mount the routers in the shared app

```js
import rescueRouter from './routes/rescue.js';
import ordersRouter from './routes/orders.js';

// After shared JSON parsing, CORS and any workspace/auth middleware:
app.use('/api/workspaces/:workspaceId/rescue', rescueRouter);
app.use('/api/workspaces/:workspaceId/orders', ordersRouter);
```

The routers use `mergeParams: true`. Shared middleware must return JSON for malformed JSON/body-size errors. The routers validate the MongoDB workspace ID, request bodies, and scenario inputs, and do not mount themselves.

For tests or alternate repository/model conventions:

```js
import { createRescueRouter } from './routes/rescue.js';
import { createOrdersRouter } from './routes/orders.js';
// Both factories accept { loadContext, buildForecast, logError }.
// Rescue also accepts createPlan for persistence tests.
```

### Register the pages

```jsx
import RescuePlanner from '../pages/RescuePlanner.jsx';
import OrderAnalyzer from '../pages/OrderAnalyzer.jsx';

<RescuePlanner workspaceId={selectedWorkspaceId} />
<OrderAnalyzer workspaceId={selectedWorkspaceId} />
```

Pass the actual selected workspace ID. An optional `apiBaseUrl` prop overrides `VITE_API_BASE_URL`; the fallback is `http://localhost:5000/api`. The feature pages fetch their own API responses and use no mock values in production. Their private shared UI module imports feature-scoped CSS automatically.

### Verify after integration

```sh
node server/tests/rescue-shared-check.mjs
```

This check deliberately imports the real `finance/forecast.js`, with no test-stub fallback. It checks the bundled rescue scenario and both order advance thresholds. It cannot run before Person 1 supplies that module.

Then run the full team's server tests, client build, seed workflow, and a real MongoDB run: load a workspace, analyze rescue and order options, save one proposal, and verify that cash items remain unchanged. Repeat after model/forecast changes.

## Engine exports

- `analyzeRescue(context, options, buildForecast)` returns the documented rescue shape plus candidates, baseline daily values, ranking rationale, warnings, assumptions and evaluation counts.
- `makeCandidates(context, maxCandidates)` returns bounded source-backed proposals.
- `applyActions(context, actions)` validates constraints and returns cloned cash items. Two actions on one source are rejected. Split portions preserve original external ID and carry source IDs.
- `analyzeNewOrder(context, order, buildForecast)` returns the documented order shape plus the feasible minimum-advance scenario, incremental funding requirement and new-breach information.
- Both engines reject incomplete/nonconsecutive forecast output and unsafe integer arithmetic.

## Explicit assumptions and limits

- Rescues search all compatible subsets of at most 12 generated actions. Each eligible item contributes one maximum permitted timing/amount proposal. This is a bounded search, not a global optimum across all possible dates and amounts. Truncation is reported.
- Action costs have no payment-date field in the supplied contract. They rank plans but are not silently assigned a cash date or subtracted from invoices. Every plan discloses this. Add dated fees to the cash inputs before using results as a funding commitment. Unknown costs remain `null`, never “free.”
- Feasibility is based on every end-of-day balance within the horizon. Same-day intraday ordering is outside the supplied model. Events outside the horizon do not appear as current-horizon cash and are warned about for orders.
- Deferred outflows remain inside the horizon. A maximum extension beyond the horizon is capped at its final day and still evaluated there.
- Split receivable IDs are temporary scenario IDs. The original external/source identifiers remain available; no MongoDB CashItem is created or updated.
- The standalone synthetic preview has no database, auth, bank connection, persistent plan, payment arrangement, or external transaction. The integrated app's save endpoint uses the `RescuePlan` model.

## Merge status and handoff

The original Person 2 feature PR has merged into `main`. Person 1 still needs to mount the routers, register the pages, and align shared test dependencies in the files assigned to them by `PARALLEL_WORK_CONTRACT.md`. Snapshot-date and plan-saving changes should be reviewed in a follow-up PR. Keep isolated test results separate from a real MongoDB persistence check, and run the full application acceptance path after shared wiring.
