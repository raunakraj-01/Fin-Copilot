# CashFlow Copilot - still on progress

Student MVP for a synthetic Indian supplier's 90-day cash outlook. The app connects setup and import, Cash Outlook, Rescue Planner, and New Order Analyzer to the same workspace and forecast engine. Saved plans and order scenarios are hypothetical; viewing or saving them does not change cash records.

The top-right language menu remembers English, Hindi or Kannada on this browser. Core navigation, forms, and decision labels are translated locally; entered business names and record IDs remain as supplied. Some detailed backend-generated explanations and warnings are still shown in English.

Cash Copilot answers runway and overdue collection questions from the active workspace through `POST /api/workspaces/:workspaceId/copilot/chat` (SSE). It can draft a collection message for a named debtor; drafts are never sent. Cash Copilot can answer locally using Ollama: keep Ollama running, set `OLLAMA_BASE_URL=http://127.0.0.1:11434` and `OLLAMA_MODEL=alibilge/Huihui-GLM-4.6V-Flash-abliterated:q4_k_s` in `server/.env`, then restart the server. The model receives only the active workspace ledger, recurring rules, calculated forecast and recent conversation. The UI labels local model answers and reports a calculated fallback if Ollama fails or times out. Ollama takes priority over optional Gemini intent classification and requires no cloud API key. API integration follows [Ollama chat](https://docs.ollama.com/api/chat). The current ledger lacks the fields required to calculate Section 43B(h) deadlines, so the copilot reports that limitation. Owner/accountant sessions and server-enforced business membership now protect every financial API. See [authentication and business isolation](docs/AUTHENTICATION.md) for setup, migration and the exact role permissions. Continue using synthetic records while validating the complete product.

The **Operations** page requires a signed-in business owner. Sync and automation credentials are generated per business, shown once and stored as hashes; they can be revoked in Setup & Import â†’ Business access. Shared admin/source/automation environment tokens and local/demo authorization bypasses are disabled. A Windows PowerShell Tally sync agent is available from Operations; standard voucher exports are flagged for owner review when balances or due dates are unavailable. Live WhatsApp sending remains opt-in and requires the configured n8n/Meta integration.

Tally sync runs report success and errors, and changed, deleted, or backdated records enter an owner review queue. Bank statement credits can be matched to customer invoices; debits can be matched to supplier bills and expenses with partial allocation and idempotent retries. Payment timing suggestions use verified settlement history for the same customer inside the same business; they show evidence and require the owner to apply a date. Cross-business pooled scoring is not used.

To test automatic payment confirmation, put Razorpay **test** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and a separate `RAZORPAY_WEBHOOK_SECRET` in `server/.env` and restart the API. Configure a Razorpay `payment_link.paid` webhook to reach `POST /api/webhooks/razorpay` on a public HTTPS URL; localhost alone cannot receive Razorpay callbacks. In Operations, preview an offer, create a Razorpay payment link, and send the new message through WhatsApp Desktop/Web. When a test payment is captured, the signed webhook applies the discounted gross settlement to the invoice exactly once; Operations checks its status every five seconds and shows the recalculated forecast. Do not claim a payment is received until the page says **confirmed**. Live keys remain rejected; production payment reconciliation is not complete.

The isolated `npm run demo` also requires account login. Choose **Use seeded demo workspace** to create an owned sample business from fixed repository fixtures. Owners can preview WhatsApp drafts and optionally add a Razorpay test payment link. No shared administrator token or public workspace claim is available.

For a container run, use `docker compose up --build` and open `http://localhost:5001`. The Compose setup stores MongoDB data in a named volume. Create an account, then load an owned sample business from Setup & Import. Use HTTPS for production sessions.

## Presentation demo

With client and server dependencies installed, run `npm run demo` from the repository root, then open `http://localhost:5000`, create an account and select **Use seeded demo workspace**. This builds the UI and starts the real API against an isolated temporary MongoDB. It never uses your configured business database. Demo edits disappear when it stops; use the normal setup below for persistence. The first run may need internet to download the MongoDB test binary. Port 5000 must be free; use the default client API URL for this launcher.

Open **Cash Shock Lab** to delay one customer's receipts by 7, 15, or 30 days, compare daily cash, stress-test the top three baseline rescue plans, and rank permitted early collections by cash impact. Negotiated early portions are delayed too. Fees stay on their modeled dates; out-of-horizon receipts remain visible in the evidence. These are chosen scenarios, not learned probabilities.

Known rescue fees now reduce forecast cash, including saved proposals. Enter **Fee payment date** in a record's constraints or leave it blank to assume the proposed action date. Unknown fees are explicitly excluded. Historical saved proposals keep their original snapshot: reanalyze and save a new proposal to include fees. CSV/XLSX imports accept an optional `Fee Payment Date` column.

The three explanation buttons always work without AI. To enable AI-selected explanations, set both `OPENAI_API_KEY` and `OPENAI_MODEL` in `server/.env` to an API key and a model available to your account that supports Responses structured outputs, then restart the server. The key stays server-side. Selected calculated facts (including synthetic customer names, dates and amounts) are sent to OpenAI only when an explanation is requested. The model selects source-backed facts; the server supplies all sentences and monetary figures. No free-form chatbot, document RAG or trained payment model is claimed. Requests time out after eight seconds; failures, refusals and unsupported evidence return a clearly labeled calculated fallback. API shape follows [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

Demo sequence: original gap **â‚¹2,00,000** â†’ Acme delayed seven days, gap **â‚¹2,50,000** â†’ early collection card reduces the original gap to **â‚¹3,000 after its fee** â†’ inspect the rescue stress table â†’ ask why and follow its invoice links. See `docs/DEMO_SCENARIO.md` for the full narrative.

## Run locally

To verify the configured Atlas connection, use `npm run db:check`. To verify real API saving and persisted reads with temporary fabricated records, use `npm run db:check -- --write-test`. See [database verification](docs/DATABASE_CHECK.md) for behavior and troubleshooting.

To test owner/accountant isolation against the running development app and Atlas, use `npm run test:atlas-isolation`. See [the live test results and manual walkthrough](docs/ATLAS_ISOLATION_TEST.md). The test uses separate fabricated accounts and businesses; it does not edit existing business records.

Dashboard pages have bookmarkable browser routes: `/setup-import`, `/cash-outlook`, `/cash-shock-lab`, `/rescue-planner`, `/new-order-analyzer`, `/cash-copilot`, `/action-center`, and `/operations`. Browser back/forward navigation and direct refreshes are supported.

The **Action Center** assembles cash-reserve risks, customer invoices due soon, supplier bills due soon, broken promises, unresolved bank transactions, Tally sync/review issues, outdated order analyses, and low-stock warnings. It can copy a daily briefing and, with the owner's browser permission, show one browser notification per day while the Action Center is open. Notifications do not run while the browser is closed. Owners can record a supplier bill decision to schedule, defer, or discuss; this does not release funds or change the cash forecast. The stock watchlist uses owner-entered quantities, reorder levels, lead times, and unit costs; it does not infer production usage. The Action Center also hosts the WhatsApp capture inbox, supplier procurement queue, and delivery-to-invoice board described below.

## Business workflow automations

The Action Center now contains three owner-supervised workflows. Inbound WhatsApp text messages sent through the n8n workflow are deduplicated and saved as drafts. The supported formats are `ORDER|customer|item|quantity|delivery_date|order_value_inr|advance_inr|advance_date|final_collection_date` and `PROMISE|invoice_id|amount_inr|promised_date` (dates are `YYYY-MM-DD`). Other text is kept for manual review; this starter flow does not capture images or voice notes. Approving a message only prefills New Order Analyzer or Payment Promises; the owner still checks the terms and saves/analyzes them.

To connect WhatsApp Cloud inbound messages, import `client/public/workflows/cashflow-message-capture.n8n.json` into n8n. Replace `REPLACE_WITH_RANDOM_VERIFY_TOKEN` and set the same verification token in Meta. In Setup & Import, create a business automation credential and store the shown-once token in an n8n HTTP Header Auth credential as `Authorization: Bearer <token>`. Change the workflow's API URL to an address reachable from your n8n host (the starter workflow uses `http://localhost:5000/api/capture-automation/messages`, which only works when that host can reach the API at localhost), then set the workflow active and use its production webhook URL in the Meta WhatsApp webhook settings. Messages are owner-reviewed drafts; this inbound workflow sends nothing.

Procurement starts from an item in the stock watchlist. Record the supplier's quoted amount, delivery lead time, and payment terms, analyze the dated supplier outflow with existing approved commitments against the reserve, then explicitly approve it as a planning commitment. The app provides copyable quote text and a reviewable WhatsApp link; it does not place the order or pay the supplier. Marking goods received adds the quantity to stock once and does not post a payment.

Fulfillment starts from a saved New Order Analyzer scenario. Track production, then confirm dispatch with proof of delivery and invoice terms. The app creates one receivable for the final balance after any linked advance invoice, without recording an advance receipt or payment. Payment Promises remains the place to confirm collections. Reminder drafts or opted-in WhatsApp follow-ups are a separate owner action; live sends still require the existing n8n follow-up configuration.

Use Node.js LTS. Start MongoDB Server locally or use a MongoDB Atlas URI. MongoDB Compass only inspects the database; it does not run the server.

1. Copy `server/.env.example` to `server/.env`; set `MONGODB_URI` and optionally `CLIENT_ORIGIN`.
2. Install server and client dependencies with `npm --prefix server install` and `npm --prefix client install`.
3. Run `npm run dev` for the API at `http://localhost:5000/api`.
4. In a second terminal, run `npm --prefix client run dev` for the app at `http://localhost:5173`.
5. Run `npm test` and `npm run build` to check the project. Tests use an isolated in-memory MongoDB, so they do not require your local database.

Open the UI and choose **Create an account**. There are no default login credentials; choose your own email and a password with at least 15 characters. After signing in, use **Setup & Import > Use seeded demo workspace** to create an owned sample business. Cash Outlook is the default page, and an authorized workspace is selected automatically when available. New workspaces default to today in India. Enter the opening cash for that snapshot date and confirm it before creating or saving the workspace.

To reproduce the fixed fixture forecast below, create a separate workspace dated `2026-11-01` with opening cash of 200000 INR and zero reserve, then import and approve `fixtures/receivables.csv` and `fixtures/payables.csv`. That historical snapshot date keeps the fixed sample movements in the forecast. The Setup screen also provides blank CSV templates, row corrections (including a missing expected-date column), manual records, monthly expenses, and an editor for the active workspace cash snapshot and reserve.

The fixture forecast first goes negative on **2026-11-06** and reaches **âˆ’â‚¹2,00,000** on **2026-11-11**. The November 26 receipt brings cash back to â‚¹2,00,000 before later scheduled movements. Outlook shows the dated movements, their source IDs, and whether dates are verified or owner assumptions. These are entered-date scenarios, not guaranteed payment predictions.

## Demo walkthrough

1. Sign in and create an owned sample business, then open **Cash Outlook** to see the shortage and its contributing bills.
2. Open **Rescue Planner**, choose a cash objective, and select **Find rescue options**. Review the conditional actions and before/after daily cash. Save a proposed plan, load saved plans, and update an action's status or notes. Customer and supplier agreement is still required.
3. Open **New Order Analyzer**. Try an â‚¹8,00,000 order with a â‚¹5,00,000 material payment on `2026-11-11`, advance date `2026-11-02`, and final collection date `2026-12-31`. Analyze the minimum advance against the **current workspace**; save the hypothetical scenario and reload the saved list. The amount need not equal the isolated â‚¹4,00,000 acceptance example because the seeded workspace already has a shortage.
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


## Cash control roadmap delivery

Operations includes collection priorities and local reminder drafts with a durable timeline for message statuses, customer responses, disputes, promise changes, and confirmed receipts. Provider delivery callbacks can be recorded with the per-business n8n credential. See [Windows Tally sync setup](docs/TALLY_WINDOWS_SYNC.md), [the follow-up guide](docs/WHATSAPP_FOLLOWUPS.md), and [backup and restore](docs/BACKUP_RESTORE.md).

The Account security panel generates one-time recovery codes, downloads a business-scoped JSON export, and shows append-only change history. Save recovery codes outside the device; they are displayed once. Configure encrypted offsite backup retention and rehearse restores before onboarding real businesses.

Additional API routes: POST /api/workspaces/:workspaceId/sync/runs; owner GET /sync/status, GET /sync/changes, and POST /sync/changes/:changeId/resolve; POST /api/workspaces/:workspaceId/bank/:transactionId/match-debit; GET/POST /api/workspaces/:workspaceId/followups/actions; GET/POST /api/workspaces/:workspaceId/reliability/payment-timing/:cashItemId and /apply; owner GET /api/workspaces/:workspaceId/trust/export and /trust/audit; POST /api/auth/recovery-codes and /api/auth/recover.

Owner inventory routes: GET/POST /api/workspaces/:workspaceId/inventory; PATCH/DELETE /api/workspaces/:workspaceId/inventory/:itemId. Owner payment decisions: PATCH /api/workspaces/:workspaceId/items/:itemId/payment-review. Order progress: owner PATCH /api/workspaces/:workspaceId/orders/scenarios/:scenarioId/tracking.

Workflow routes: owner GET /api/workspaces/:workspaceId/captures and POST /captures/:captureId/review; automation POST /api/capture-automation/messages; GET/POST /api/workspaces/:workspaceId/procurement and the quote, analyze, status, and receive routes under /procurement/:requestId; GET/POST /api/workspaces/:workspaceId/fulfillment and the status, dispatch, and collection-followup routes under /fulfillment/:orderId. Automation ingestion requires the business-scoped automation bearer credential. Owner review actions use the normal signed-in session and workspace authorization.
