# CashFlow Copilot - still on progress

Student MVP for a synthetic Indian supplier's 90-day cash outlook. The app connects setup and import, Cash Outlook, Rescue Planner, and New Order Analyzer to the same workspace and forecast engine. Saved plans and order scenarios are hypothetical; viewing or saving them does not change cash records.

The top-right language menu remembers English, Hindi or Kannada on this browser. Core navigation, forms, and decision labels are translated locally; entered business names and record IDs remain as supplied. Some detailed backend-generated explanations and warnings are still shown in English.

Cash Copilot answers runway and overdue collection questions from the active workspace through `POST /api/workspaces/:workspaceId/copilot/chat` (SSE). It can draft a collection message for a named debtor; drafts are never sent. Cash Copilot can answer locally using Ollama: keep Ollama running, set `OLLAMA_BASE_URL=http://127.0.0.1:11434` and `OLLAMA_MODEL=alibilge/Huihui-GLM-4.6V-Flash-abliterated:q4_k_s` in `server/.env`, then restart the server. The model receives only the active workspace ledger, recurring rules, calculated forecast and recent conversation. The UI labels local model answers and reports a calculated fallback if Ollama fails or times out. Ollama takes priority over optional Gemini intent classification and requires no cloud API key. API integration follows [Ollama chat](https://docs.ollama.com/api/chat). The current ledger lacks the fields required to calculate Section 43B(h) deadlines, so the copilot reports that limitation. Owner/accountant sessions and server-enforced business membership now protect every financial API. See [authentication and business isolation](docs/AUTHENTICATION.md) for setup, migration and the exact role permissions. Continue using synthetic records while validating the complete product.

The **Operations** page requires a signed-in business owner. Sync and automation credentials are generated per business, shown once and stored as hashes; they can be revoked in Setup & Import → Business access. Shared admin/source/automation environment tokens and local/demo authorization bypasses are disabled. There is still no installed Tally desktop daemon or configured live Meta sender.

The Tally connection flow enrolls a business-scoped sync device and can import paid observations with explicit consent. Observations and reliability lookups are restricted to the current business; cross-business pooled scoring is disabled under strict data isolation.

To test automatic payment confirmation, put Razorpay **test** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and a separate `RAZORPAY_WEBHOOK_SECRET` in `server/.env` and restart the API. Configure a Razorpay `payment_link.paid` webhook to reach `POST /api/webhooks/razorpay` on a public HTTPS URL; localhost alone cannot receive Razorpay callbacks. In Operations, preview an offer, create a Razorpay payment link, and send the new message through WhatsApp Desktop/Web. When a test payment is captured, the signed webhook applies the discounted gross settlement to the invoice exactly once; Operations checks its status every five seconds and shows the recalculated forecast. Do not claim a payment is received until the page says **confirmed**. Live keys remain rejected; production payment reconciliation is not complete.

The isolated `npm run demo` also requires account login. Choose **Use seeded demo workspace** to create an owned sample business from fixed repository fixtures. Owners can preview WhatsApp drafts and optionally add a Razorpay test payment link. No shared administrator token or public workspace claim is available.

For a container run, use `docker compose up --build` and open `http://localhost:5001`. The Compose setup stores MongoDB data in a named volume. Create an account, then load an owned sample business from Setup & Import. Use HTTPS for production sessions.

## Presentation demo

With client and server dependencies installed, run `npm run demo` from the repository root, then open `http://localhost:5000`, create an account and select **Use seeded demo workspace**. This builds the UI and starts the real API against an isolated temporary MongoDB. It never uses your configured business database. Demo edits disappear when it stops; use the normal setup below for persistence. The first run may need internet to download the MongoDB test binary. Port 5000 must be free; use the default client API URL for this launcher.

Open **Cash Shock Lab** to delay one customer's receipts by 7, 15, or 30 days, compare daily cash, stress-test the top three baseline rescue plans, and rank permitted early collections by cash impact. Negotiated early portions are delayed too. Fees stay on their modeled dates; out-of-horizon receipts remain visible in the evidence. These are chosen scenarios, not learned probabilities.

Known rescue fees now reduce forecast cash, including saved proposals. Enter **Fee payment date** in a record's constraints or leave it blank to assume the proposed action date. Unknown fees are explicitly excluded. Historical saved proposals keep their original snapshot: reanalyze and save a new proposal to include fees. CSV/XLSX imports accept an optional `Fee Payment Date` column.

The three explanation buttons always work without AI. To enable AI-selected explanations, set both `OPENAI_API_KEY` and `OPENAI_MODEL` in `server/.env` to an API key and a model available to your account that supports Responses structured outputs, then restart the server. The key stays server-side. Selected calculated facts (including synthetic customer names, dates and amounts) are sent to OpenAI only when an explanation is requested. The model selects source-backed facts; the server supplies all sentences and monetary figures. No free-form chatbot, document RAG or trained payment model is claimed. Requests time out after eight seconds; failures, refusals and unsupported evidence return a clearly labeled calculated fallback. API shape follows [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

Demo sequence: original gap **₹2,00,000** → Acme delayed seven days, gap **₹2,50,000** → early collection card reduces the original gap to **₹3,000 after its fee** → inspect the rescue stress table → ask why and follow its invoice links. See `docs/DEMO_SCENARIO.md` for the full narrative.

## Run locally

To verify the configured Atlas connection, use `npm run db:check`. To verify real API saving and persisted reads with temporary fabricated records, use `npm run db:check -- --write-test`. See [database verification](docs/DATABASE_CHECK.md) for behavior and troubleshooting.

To test owner/accountant isolation against the running development app and Atlas, use `npm run test:atlas-isolation`. See [the live test results and manual walkthrough](docs/ATLAS_ISOLATION_TEST.md). The test uses separate fabricated accounts and businesses; it does not edit existing business records.

Use Node.js LTS. Start MongoDB Server locally or use a MongoDB Atlas URI. MongoDB Compass only inspects the database; it does not run the server.

1. Copy `server/.env.example` to `server/.env`; set `MONGODB_URI` and optionally `CLIENT_ORIGIN`.
2. Run `cd server && npm install && npm run seed` to create the repeatable synthetic demo workspace (`650000000000000000000001`).
3. Run `cd server && npm run dev` for the API at `http://localhost:5000/api`.
4. Run `cd client && npm install && npm run dev` for the app at `http://localhost:5173`.
5. Run `cd server && npm test` and `cd client && npm run build` to check the project. Tests use an isolated in-memory MongoDB, so they do not require your local database.

Open the UI, create an account and select **Use seeded demo workspace** to create an owned sample business. The CLI seed is separate and remains locked until assigned with the ownership migration script. To exercise the import flow, create a new workspace dated `2026-11-01` with ₹2,00,000 opening cash and ₹0 reserve, then import and approve `fixtures/receivables.csv` and `fixtures/payables.csv`. The Setup screen also provides blank CSV templates, row corrections (including a missing expected-date column), manual records, monthly expenses, and an editor for the active workspace's cash snapshot and reserve.

The fixture forecast first goes negative on **2026-11-06** and reaches **−₹2,00,000** on **2026-11-11**. The November 26 receipt brings cash back to ₹2,00,000 before later scheduled movements. Outlook shows the dated movements, their source IDs, and whether dates are verified or owner assumptions. These are entered-date scenarios, not guaranteed payment predictions.

## Demo walkthrough

1. Sign in and create an owned sample business, then open **Cash Outlook** to see the shortage and its contributing bills.
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

Database-backed sessions, CSRF validation and owner/accountant business authorization are implemented. Production use still requires HTTPS, backups and the deployment controls in [AUTHENTICATION.md](docs/AUTHENTICATION.md). Legacy ownerless workspaces stay locked until assigned through the local administration script.

For the RTX 4050 Windows demo, the local configuration uses a separate Ollama service on port 11435 with `OLLAMA_LLM_LIBRARY=cuda_v12`, `OLLAMA_NUM_GPU=26`, and `OLLAMA_NUM_CTX=4096`. This avoids the observed CUDA 13 warm-up crash and offloads 26 model layers while keeping VRAM usage within 6 GB. Set `OLLAMA_EXECUTABLE` and `OLLAMA_MODELS` to your local installation and model directory; `npm run demo` and the backend start command automatically start that service if needed. The ordinary Ollama service on port 11434 is unchanged.

Operations includes proactive collection priorities and scheduled local follow-up drafts, with pause controls, attempt limits, current-balance checks and follow-up history. Download the inactive n8n workflow from Operations for optional WhatsApp Business automation. Live sends stay disabled by default. See [the demo and n8n setup guide](docs/WHATSAPP_FOLLOWUPS.md).
