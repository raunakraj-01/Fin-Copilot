# Person 1 — Finance Foundation Agent Prompt

You are Person 1 working on `feature/finance-core` in a two-person **parallel** CashFlow Copilot build.

Read `docs/PARALLEL_WORK_CONTRACT.md` FIRST, then read all six original Markdown documents in `docs/` and both CSV fixtures. Treat the parallel contract as binding for ownership and module interfaces. **Do not run or follow any old full-app master prompt.**

## Task (own Features 1 and 2)

1. **Before Person 2 branches:** create and commit the minimal runnable skeleton on `main`: React/Vite JavaScript client, Node/Express JavaScript server, Mongoose connection setup, entry files, shared app router, placeholders for Rescue and Order pages/routes, minimal `buildForecast` module with the agreed exports, sample fixtures/test harness, dependencies and `.env.example`. Commit/push and tell Person 2 the commit SHA. Then branch `feature/finance-core` from that commit.
2. Implement the Workspace / CashItem / ImportBatch (and any required documented models) and API endpoints for workspace CRUD, import inspect/validate/commit, manual item creation/correction, and 90-day forecast. Support standardized CSV/XLSX fixtures. No bank sync or universal OCR.
3. Implement the **one canonical pure forecast engine** exactly at `server/src/services/finance/forecast.js` and exports specified in `docs/PARALLEL_WORK_CONTRACT.md`. Calculate dated cash movements, daily closing balances, initial negative day, reserve breaches and traceable contributing transactions. Never double count settlements.
4. Implement `SetupImport` and `Outlook` React pages, shared React navigation, data cards, Recharts chart and API client. Make initial UI readable; polish later.
5. Implement core financial unit tests / import tests, seed script and realistic demonstration via provided fixtures.
6. Person 2 will export `rescue.js`, `orders.js`, `RescuePlanner.jsx`, and `OrderAnalyzer.jsx`. **You alone integrate** these into `server/src/app.js`, `client/src/app/App.jsx`, and shared API wrappers when modules are ready. Keep their feature module internals intact.

## You may edit

Only files owned by Person 1 in `docs/PARALLEL_WORK_CONTRACT.md` plus shared integration files. Do not implement or modify Person 2 rescue/order modules. Never edit `docs/` specs without agreement.

## Completion criteria

Run install, seed, tests, and verify requests return documented JSON. Prove baseline fixture first negative date and worst balance from `ACCEPTANCE_TESTS.md`. Report changed files, commands, endpoints, any unresolved integration gaps, and the base commit SHA. Do not claim the full application is complete if Person 2 modules are not merged.
