# CashFlow Copilot

Student MVP for a synthetic Indian supplier's 90-day cash outlook. The app connects setup and import, Cash Outlook, Rescue Planner, and New Order Analyzer to the same workspace and forecast engine. Saved plans and order scenarios are hypothetical; viewing or saving them does not change cash records.

The top-right language menu remembers English, Hindi or Kannada on this browser. Core navigation, forms, and decision labels are translated locally; entered business names and record IDs remain as supplied. Some detailed backend-generated explanations and warnings are still shown in English.

Cash Copilot answers runway and overdue collection questions from the active workspace through `POST /api/workspaces/:workspaceId/copilot/chat` (SSE). It can draft a collection message for a named debtor; drafts are never sent. Set `GEMINI_API_KEY` in `server/.env` to enable model-based intent classification, optionally with `GEMINI_MODEL`; without a key or when the model fails, local rules select the intent. Financial answers always come from the existing forecast and ledger. The current ledger lacks the fields required to calculate Section 43B(h) deadlines, so the copilot reports that limitation. The app still has no authentication and is for synthetic data only.

For a container run, use `docker compose up --build` and open `http://localhost:5001`. The Compose setup stores MongoDB data in a named volume. Seed the demo workspace with `docker compose exec hisaab-app node src/seed/index.js`.

## Presentation demo

With client and server dependencies installed, run `npm run demo` from the repository root, then open `http://localhost:5000` and select **Use seeded demo workspace**. This builds the UI and starts the real API against an isolated temporary MongoDB. It never uses your configured business database. Demo edits disappear when it stops; use the normal setup below for persistence. The first run may need internet to download the MongoDB test binary. Port 5000 must be free; use the default client API URL for this launcher.

Open **Cash Shock Lab** to delay one customer's receipts by 7, 15, or 30 days, compare daily cash, stress-test the top three baseline rescue plans, and rank permitted early collections by cash impact. Negotiated early portions are delayed too. Fees stay on their modeled dates; out-of-horizon receipts remain visible in the evidence. These are chosen scenarios, not learned probabilities.

Known rescue fees now reduce forecast cash, including saved proposals. Enter **Fee payment date** in a record's constraints or leave it blank to assume the proposed action date. Unknown fees are explicitly excluded. Historical saved proposals keep their original snapshot: reanalyze and save a new proposal to include fees. CSV/XLSX imports accept an optional `Fee Payment Date` column.

The three explanation buttons always work without AI. To enable AI-selected explanations, set both `OPENAI_API_KEY` and `OPENAI_MODEL` in `server/.env` to an API key and a model available to your account that supports Responses structured outputs, then restart the server. The key stays server-side. Selected calculated facts (including synthetic customer names, dates and amounts) are sent to OpenAI only when an explanation is requested. The model selects source-backed facts; the server supplies all sentences and monetary figures. No free-form chatbot, document RAG or trained payment model is claimed. Requests time out after eight seconds; failures, refusals and unsupported evidence return a clearly labeled calculated fallback. API shape follows [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

Demo sequence: original gap **₹2,00,000** → Acme delayed seven days, gap **₹2,50,000** → early collection card reduces the original gap to **₹3,000 after its fee** → inspect the rescue stress table → ask why and follow its invoice links. See `docs/DEMO_SCENARIO.md` for the full narrative.

## Run locally

Use Node.js LTS. Start MongoDB Server locally or use a MongoDB Atlas URI. MongoDB Compass only inspects the database; it does not run the server.

1. Copy `server/.env.example` to `server/.env`; set `MONGODB_URI` and optionally `CLIENT_ORIGIN`.
2. Run `cd server && npm install && npm run seed` to create the repeatable synthetic demo workspace (`650000000000000000000001`).
3. Run `cd server && npm run dev` for the API at `http://localhost:5000/api`.
4. Run `cd client && npm install && npm run dev` for the app at `http://localhost:5173`.
5. Run `cd server && npm test` and `cd client && npm run build` to check the project. Tests use an isolated in-memory MongoDB, so they do not require your local database.

Open the UI and select **Use seeded demo workspace** to inspect seeded data. To exercise the import flow, create a new workspace dated `2026-11-01` with ₹2,00,000 opening cash and ₹0 reserve, then import and approve `fixtures/receivables.csv` and `fixtures/payables.csv`. The Setup screen also provides blank CSV templates, row corrections (including a missing expected-date column), manual records, monthly expenses, and an editor for the active workspace's cash snapshot and reserve.

The fixture forecast first goes negative on **2026-11-06** and reaches **−₹2,00,000** on **2026-11-11**. The November 26 receipt brings cash back to ₹2,00,000 before later scheduled movements. Outlook shows the dated movements, their source IDs, and whether dates are verified or owner assumptions. These are entered-date scenarios, not guaranteed payment predictions.

## Demo walkthrough

1. Select the seeded workspace, then open **Cash Outlook** to see the shortage and its contributing bills.
2. Open **Rescue Planner**, choose a cash objective, and select **Find rescue options**. Review the conditional actions and before/after daily cash. Save a proposed plan, load saved plans, and update an action's status or notes. Customer and supplier agreement is still required.
3. Open **New Order Analyzer**. Try an ₹8,00,000 order with a ₹5,00,000 material payment on `2026-11-11`, advance date `2026-11-02`, and final collection date `2026-12-31`. Analyze the minimum advance against the **current workspace**; save the hypothetical scenario and reload the saved list. The amount need not equal the isolated ₹4,00,000 acceptance example because the seeded workspace already has a shortage.
4. Change a record constraint in Setup, rerun the analysis, and check the updated result. Saved proposals are snapshots; reanalyze after changing cash records.

`npm test` runs an in-memory MongoDB seeded workflow covering forecast, rescue proposal saving and tracking, and order scenario saving. It verifies that these decisions leave the underlying cash items untouched.

## API

- `GET /api/health`
- `POST /api/workspaces`; `GET/PATCH /api/workspaces/:workspaceId`
- `POST /api/workspaces/:workspaceId/imports/inspect` (multipart `file`, `kind`), `POST .../imports/:batchId/validate`, `POST .../imports/:batchId/commit`
- `GET/POST /api/workspaces/:workspaceId/items`; `PATCH/DELETE /api/workspaces/:workspaceId/items/:itemId`
- `GET/POST /api/workspaces/:workspaceId/recurring-rules`
- `GET /api/workspaces/:workspaceId/forecast?horizonDays=90`
- `POST /api/workspaces/:workspaceId/shock/analyze` (`counterparty` optional, `delayDays`: 7/15/30)
- `POST /api/workspaces/:workspaceId/shock/explain` (same inputs plus `question`: `shortage`, `collection`, or `stress`)
- `POST /api/workspaces/:workspaceId/rescue/analyze`; `GET/POST .../rescue/plans`; `PATCH .../rescue/plans/:planId/actions/:actionId`
- `POST /api/workspaces/:workspaceId/orders/analyze`; `GET/POST .../orders/scenarios`

All API monetary values are integer paise. Imports are reviewed before commit, repeated commits are idempotent, and imported source IDs do not overwrite existing records. The pure finance engine is `server/src/services/finance/forecast.js` with the agreed `buildForecast` and `explainRisk` exports. Rescue and order simulations use that engine and persist only explicit hypothetical plans or scenarios.

This is a single-workspace demo without authentication. Do not upload real financial records or expose this API publicly.
