# Parallel Development Contract — READ FIRST (shared by both agents)

This document is the **only added shared specification**. Original `SYSTEM_DESIGN.md`, `TECH_STACK.md`, `DATABASE_ARCHITECTURE.md`, `API_CONTRACT.md`, `ACCEPTANCE_TESTS.md`, and `DEMO_SCENARIO.md` remain **unchanged**. If something appears ambiguous, refer to those specs and coordinate before changing any public contract.

## One-time kickoff / branch order

1. Person 1 creates the project skeleton and commits it on `main` **before** Person 2 branches: root package choices, `client/`, `server/`, basic runnable React + Express, Mongoose wiring, reusable empty route/component placeholders, and `server/src/services/finance/forecast.js` with agreed exported functions (stub acceptable initially). Commit and push.
2. Person 2 pulls `main`, then creates `feature/decision-engine`. Person 1 creates `feature/finance-core` from the **same** base commit.
3. Both read all `docs/` specs and use their own person-specific prompt in `prompts/`. **Do not use the old `AGENT_BUILD_PROMPT.md`**; it instructs both agents to build the full application.
4. During development, if shared contracts must change, discuss first. One owner changes the shared file on `main`, commits, and both branches integrate that commit. Never silently diverge.

## Strict write ownership

**Person 1 owns:** `server/src/models/**`, `server/src/config/**`, `server/src/services/imports/**`, `server/src/services/finance/**`, `server/src/utils/**`, `server/src/validators/**`, `server/src/routes/workspaces*`, `server/src/routes/imports*`, `server/src/routes/items*`, `server/src/routes/forecast*`, `server/src/controllers/` files related to those routes, `client/src/pages/SetupImport*`, `client/src/pages/Outlook*`, `server/src/seed/**`, `server/tests/finance*`, `server/tests/import*`.

**Person 2 owns:** `server/src/services/rescue/**`, `server/src/services/orders/**`, `server/src/routes/rescue*`, `server/src/routes/orders*`, `server/src/controllers/` files related to those routes, `client/src/pages/RescuePlanner*`, `client/src/pages/OrderAnalyzer*`, `server/tests/rescue*`, `server/tests/orders*`.

**Person 1 owns all shared integration files:** `server/src/app.js`, `server/src/index.js`, `client/src/app/App.jsx`, `client/src/main.jsx`, `client/src/services/api.js`, root and client/server `package.json`, lockfiles, shared components and styles, `.env.example`, `README.md`. Person 2 does **not** edit these directly; supplies exported router/page modules and integration instructions to Person 1.

**Read-only for both agents:** `docs/**`, `fixtures/**`. Update specs only with both developers' approval. Each person can create *new* tests solely for their modules.

## Canonical financial module interface (frozen before parallel branching)

File: `server/src/services/finance/forecast.js` owned by Person 1.

```js
export function buildForecast({ asOfDate, horizonDays = 90, openingCashPaise, minimumReservePaise = 0, cashItems = [], recurringRules = [], additionalEvents = [] }) { /* -> forecast object */ }
export function explainRisk(forecast, cashItems = []) { /* -> risk object */ }
```

- `cashItems`: normalized plain objects from `CashItem` model with `id` or `_id`, `externalId`, `category`, `amountPaise`, `settledPaise`, `dueDate`, `expectedDate`, and `status` plus optional `mandatory`, `negotiable`, `discretionary`, `maxExtensionDays`, `earliestCollectionDate`, `maxEarlyCollectionPaise`, and `estimatedActionCostPaise`. Do not assume optional fields exist.
- `additionalEvents`: hypothetical cash events `{id, date:'YYYY-MM-DD', direction:'in'|'out', amountPaise, description, sourceId}` used only for scenarios. This is **not** a persisted cash receipt.
- Function result follows the `/forecast` JSON shape in `API_CONTRACT.md` (`daily`, `risk`, `warnings`, `assumptions` plus forecast metadata). No DB access or mutable global state inside this function.
- Rescue timing changes should be represented by cloning and modifying relevant `cashItems` in memory before calling `buildForecast`, not by inserting an extra receipt or mutating MongoDB. Order scenarios use `additionalEvents` plus unchanged baseline items.
- Both sides exclusively use integer paise and date-only `YYYY-MM-DD`. No separate rescue-specific cash balance algorithm.
- Person 1 commits this module and a fixture-based test early. Person 2 may implement against mock functions with *exactly* these signatures before it is ready.

## Router and page exports (integration contract)

- Person 2 creates `server/src/routes/rescue.js` and `server/src/routes/orders.js` with **default-exported Express routers**, mounted by Person 1 at `/api/workspaces/:workspaceId/rescue` and `/api/workspaces/:workspaceId/orders` with `mergeParams: true` (or equivalent paths preserving the exact API contract). Route modules are not allowed to mount themselves.
- Person 2 creates `client/src/pages/RescuePlanner.jsx` and `client/src/pages/OrderAnalyzer.jsx` with **default-exported React components**. Person 1 registers them in the shared app router.
- Person 2 uses `fetch` or a private module under their own feature folder while developing; requests edits to shared `client/src/services/api.js` from Person 1.
- Person 2 may add dependencies only by asking Person 1 to install and commit them. No independent edits of shared package files.

## Integration / done criteria

- End of Day 1: runnable shared skeleton, forecast function contract + fixtures, both feature modules independently testable.
- End of Day 2: Person 2 opens a pull request; Person 1 integrates routers/pages, resolves imports and runs smoke tests. No last-day-only merge.
- End of Day 3: imports -> forecast -> rescue -> new order full path works on seed data; acceptance tests and a real database persistence check pass.
- Only if core is working: Day 4 UI polish / optional action tracking.

## Safety / math rules both must follow

No paid-invoice double count, no counting an accelerated invoice twice, no treating a shifted bill beyond the timeline as proof a plan succeeded, no presenting user-approval-dependent actions as guaranteed, no fabricated ML or AI calculations. Use dataset fixture tests in `ACCEPTANCE_TESTS.md`.
