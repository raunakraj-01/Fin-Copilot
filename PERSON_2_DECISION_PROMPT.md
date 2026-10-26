# Person 2 — Decision Intelligence Agent Prompt

You are Person 2 working on `feature/decision-engine` in a two-person **parallel** CashFlow Copilot build.

Read `docs/PARALLEL_WORK_CONTRACT.md` FIRST, then the original six specs in `docs/` and sample CSVs. Branch **only after Person 1 has committed the runnable skeleton and the shared forecast interface**. Start from that exact `main` commit. **Do not use any old full-app master prompt.**

## Task (own Features 3 and 4)

1. Build the Automatic Cash Rescue Planner in `server/src/services/rescue/**`: generate actions from actual open receivables, negotiable supplier bills and discretionary expenses; respect dates, maximum permitted changes, user reserve, mandatory payments and approval-dependent status. Evaluate candidate combinations through the **shared** `buildForecast` import; do not write a second forecasting engine. Rank valid plans by known costs, and make unknown costs explicit. Return partial mitigations if no feasible plan exists.
2. Build the New Order Impact Analyzer in `server/src/services/orders/**`: accept order value, advance date/amount, expense lines, final collection date and optional delayed payment scenario. Add only *hypothetical* events to the shared forecast, compute liquidity impact and the minimum advance needed where possible. Keep the baseline documents untouched.
3. Implement documented `POST .../rescue/analyze`, `POST .../orders/analyze` and, if time permits, save-plan / save-scenario endpoints as **default-exported** routers in `server/src/routes/rescue.js` and `server/src/routes/orders.js`. Read CashItem and workspace models provided by Person 1; do not edit their model/schema code.
4. Build default-exported `client/src/pages/RescuePlanner.jsx` and `client/src/pages/OrderAnalyzer.jsx`. Use real backend responses; until Person 1 API is available, use synthetic fixtures with exactly the same contract. Include intuitive assumptions and conditional-action labels.
5. Write rescue/order pure-function tests based on `ACCEPTANCE_TESTS.md`, including changed invoice timing (not new cash), all-day safety checks, postponed-payment reappearance, and infeasible order advances.

## You may edit

Only Person 2 paths in `docs/PARALLEL_WORK_CONTRACT.md`. **Do not edit** `server/src/app.js`, `server/src/index.js`, `client/src/app/App.jsx`, `client/src/services/api.js`, database schemas, `package.json`, dependency locks, docs or shared styles. Export self-contained components/routers; tell Person 1 which imports, mounts and new npm dependencies are needed.

## Completion criteria

Provide changed file list, tested scenarios, expected exports, a PR/merge instruction and known constraints. Confirm the rescue and order engines call the same `buildForecast`. Do not claim any external payment arrangement has been agreed. Leave shared integration files to Person 1.
