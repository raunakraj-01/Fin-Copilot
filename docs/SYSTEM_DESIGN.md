# CashFlow Copilot — System Design (MVP v1)

> **Purpose:** A decision-support layer for small Indian B2B suppliers. It uses existing accounting exports to forecast cash, explain shortages, automatically test feasible rescue actions, and evaluate whether a new order is affordable.
>
> **Deadline/scope:** Working 3–4-day student-project MVP. This is **not** a full accounting, ERP, banking, or production financial-advice system.

## 1. Product contract

**Target user:** A small B2B supplier/manufacturer that sells on credit, uses Tally or spreadsheets, and has to pay suppliers and staff before customers necessarily pay.

**Primary user journey:**
1. Create a demo business/workspace and set **opening available bank cash as of a date**, **minimum desired cash reserve**, and optionally recurring monthly expenses.
2. Upload two **structured CSV/XLSX files**: open customer receivables and open supplier bills/expenses. A mapping step lets the user choose columns.
3. Review rejected/ambiguous rows. Confirm amounts, due dates, and expected dates. Do not silently treat uncertain records as verified.
4. View a daily **90-day cash forecast** with first negative-balance date, first safety-buffer breach, worst projected balance, contributing events and assumptions.
5. Open **Cash Rescue Planner**. The system proposes specific possible changes to customer collection dates or flexible supplier/expense payments, tests combinations, and ranks valid plans.
6. Open **New Order Analyzer**. Enter a prospective order, material/production costs, advance and customer payment date. See whether it worsens cash and the **minimum advance** needed to preserve the reserve, if a feasible advance exists.
7. Optional: save a plan, mark actions requested/accepted/rejected/completed, adjust expected cash dates, and rerun the same forecast.

**Success metric for demo:** From imported records to a fully traceable shortage explanation and at least one algorithmically evaluated plan. An owner must be able to see what assumptions would need to come true.

## 2. Architecture

```text
CSV / XLSX files         Manual balances / expenses / proposed orders
       |                                  |
       v                                  v
[React app: Import, Review, Forecast, Rescue, Order]
       | REST / JSON                         ^
       v                                     |
[Node.js / Express API + input validation + error handling]
       |
       +--> Import adapter / column mapping / dedupe / review
       +--> Financial record repository (Mongoose / MongoDB)
       +--> Daily forecast engine (pure JavaScript)
       +--> Shortage explanation engine (event attribution)
       +--> Candidate intervention generator (rules)
       +--> Constraint checker + rescue-combination evaluator
       +--> New-order scenario + minimum-advance search
       +--> Optional action-state tracker
       |
       v
[MongoDB: workspace, cash_items, recurring_rules, import_batches,
          rescue_plans, order_scenarios]

Optional LLM: receives ONLY validated forecast/plan JSON to draft plain-English
explanations; no LLM arithmetic, no LLM-only financial decisions, no RAG.
```

**Design choice:** A modular monolith in one `server/`, not microservices. Engines are plain pure-JavaScript modules that can be unit-tested without a database.

## 3. Core domain rules (non-negotiable)

- Store money as **integer paise**; render ₹ at the UI. Never use floating-point rupees for financial addition or optimization.
- Store business event dates as `YYYY-MM-DD` **date-only strings** interpreted in **Asia/Kolkata**. Store audit timestamps as UTC Dates. Do not use `new Date('YYYY-MM-DD')` and local conversions that shift a financial event to another day.
- Opening bank cash is an **as-of-today snapshot**, so earlier bank receipts/payments are already included. **Never add past transactions again**. Only remaining amounts scheduled after `asOfDate` flow into the forecast.
- A settled invoice contributes **zero future cash**. A partially paid invoice contributes **only its open balance**, and must not double-count bank deposits.
- An invoice with a due date before the forecast start but no credible future expected date is **flagged for user verification**. Do not silently invent when it will be paid.
- The 90-day horizon is daily. Each day: opening balance + scheduled receipts - scheduled payments. Distinguish **negative cash balance** from **breach of minimum safety reserve**.
- Every cash movement must be traceable to a cash-item ID, recurring rule occurrence, or order scenario. Support reasons such as `customer_invoice`, `supplier_bill`, `expense`, `order_advance`, and `order_receipt`.
- The default timeline is a **scenario based on expected payment dates**, not a prediction guaranteed to happen. Show assumptions and data warnings.
- Proposed rescues and orders are **hypothetical until the owner approves them**. Do not overwrite original financial records merely because a simulation is viewed.
- Prefer correctness over appearance: show **“no feasible rescue found under current assumptions”** rather than fabricate a solution.

## 4. Features and their exact responsibilities

### F1 — Import & verification (P0)
**Inputs:** opening balance, minimum reserve, receivables CSV/XLSX, payables/expenses CSV/XLSX, optional monthly recurring expenses.
**Processing:** normalize headers/amounts/dates; map user columns; dedupe within a batch and against existing records by workspace + type + source + external ID; show suspicious amounts, missing date, future paid status, invalid/outstanding values. Require correction or explicit exclusion.
**Outputs:** approved cash items, import preview (accepted/review/rejected), clear data quality warning count.
**Deliberate limit:** No direct Tally API, no universal PDF extraction or full bank reconciliation in MVP. A Tally **exported spreadsheet** is supported if columns can be mapped. Standardized bank-CSV verification is stretch only.

### F2 — 90-day forecast & explanation (P0)
**Inputs:** confirmed starting cash + remaining open items + recurring expenses + expected dates + threshold + as-of date.
**Processing:** materialize 90 days of incoming/outgoing events; compute daily balances; find first negative day and first reserve breach; sort largest upcoming drivers; attach IDs and evidence status.
**Outputs:** line chart; key metrics; dated list of receipts/payments; a sentence such as: “Cash first turns negative on 12 Nov because supplier bill S-19 is due before customer invoice C-08 is expected.”
**Non-goals:** ML, GST/tax calculation, financing eligibility, guaranteed payment-time prediction.

### F3 — Automatic Cash Rescue Planner (P0; headline feature)
**Inputs:** forecast, open receivables, negotiable outflows, reserve threshold, owner-configured bounds and optional intervention costs.
**Processing:**
1. Identify the first shortfall or reserve breach.
2. Generate **up to 10–12 plausible candidate actions** grounded in records: collect all/part of an open invoice earlier (only within allowed date and amount); move a negotiable supplier payment to a later allowed date; postpone a discretionary expense.
3. Exclude mandatory bills, paid invoices, impossible dates, repeat interventions on the same item, and options explicitly prohibited by business constraints.
4. Apply each combination to a **copy** of the base events, re-run the full 90-day daily forecast, and accept it only if the **entire 90-day period** meets the selected objective (nonnegative cash or user reserve).
5. Rank acceptable plans by **explicit estimated financial cost**, then number of changes, then reserve headroom. Unknown costs are marked unknown, **not assumed to be free**. If no complete fix, show highest-impact partial mitigations clearly as partial.
**Outputs:** top 3 plans; affected invoice/bill references, proposed dates and amounts, before/after graph, remaining risk, explicit “requires customer/supplier agreement” warnings.
**Guardrails:** Moving a payment **moves it**, never creates cash; splitting an invoice into early and regular collections cannot exceed its open amount; negotiated changes may fail; don't push a payment outside the horizon merely to hide the deficit (restrict to within 90 days for MVP).

### F4 — New Order Cash Impact Analyzer (P0; second headline feature)
**Inputs:** proposed order value, anticipated order-advance receipt date/amount, material/production costs **with payment date(s)**, customer final-payment date, optionally supplier-credit alternatives.
**Processing:** add only the order's incremental timeline events to the baseline (do not save into official cash items). Evaluate order with current terms and in a delayed-customer-payment stress scenario. **Search the smallest advance between ₹0 and order value** that maintains minimum reserve over **every day** in the horizon; remaining order revenue is paid on final-payment date. If full advance still cannot make the plan feasible, say so.
**Outputs:** projected impact, max incremental cash requirement, first new breach, minimum possible advance, optional safer terms, baseline vs accepted-order charts, assumed dates.
**Critical:** This is a **cash feasibility** recommendation, not profit/loss or automatic order acceptance. Show warnings if order events fall outside the 90-day window or baseline is already in shortage (the order might not be the cause).

### F5 — Plan execution feedback (P1 / Day 4)
**Inputs:** selected plan, intervention status (`proposed`, `requested`, `agreed`, `rejected`, `completed`), revised dates, notes.
**Processing:** store actions and a lightweight audit trail. An agreed action updates a **planning assumption** only when user confirms its date and amount. A completed real payment must also update cash snapshot / invoice paid state explicitly to prevent double counting.
**Outputs:** next steps list, status indicators, forecast refresh and new plans after rejection.
**Time-box rule:** Do not delay F3/F4 to implement this.

## 5. Frontend screens

1. **Setup / Import:** starting cash, safety reserve, as-of date, download templates, import preview/map/review.
2. **Cash Outlook:** 90-day chart, first negative day, low-buffer warning, largest drivers, verified-vs-assumed labels.
3. **Rescue Planner:** suggested candidate actions, ranked plan cards, before/after chart, reasons and constraints.
4. **New Order Analyzer:** concise form, effect on current timeline, minimum advance, compare scenarios.
5. **Plan Tracker** (stretch): actionable status table.

A modern professional UI is welcome (React Bits sparingly), but all graphs, statuses, and amounts must reflect real backend output. No mock financial calculations in React.

## 6. Deterministic engine module boundaries

```text
parseImport(file, mapping) -> normalized proposed rows + validation issues
approveRows(rows) -> upsert-ready items
buildDailyEvents(items, recurringRules, asOfDate, horizonDays) -> events
buildForecast(openingPaise, reservePaise, events) -> 90 daily points + risks
explainRisk(forecast, events) -> contributing dated record IDs
makeCandidates(items, initialRisk, ownerRules) -> <=12 candidate interventions
applyActions(events, actions) -> altered events (immutable)
rankRescuePlans(forecastContext, candidates) -> complete/partial plans
analyzeNewOrder(forecastContext, draftOrder) -> scenarios + minimum advance
```

No LLM call belongs anywhere in these functions.

## 7. Security & trust baseline for student demo

- Use seeded **synthetic company records**, not actual bank/customer records, for live presentations.
- Validate file type and size, row count, request inputs and all amounts/dates on the server. Never parse unknown uploads as executable content.
- Keep secret keys and MongoDB credentials server-only in `.env`; provide `.env.example` without secrets.
- Implement a single **demo workspace** if authentication is out of scope; label it non-production. Do not call this multi-tenant secure.
- No financial transaction execution, bank credentials, automated WhatsApp collection messages, or live lender actions.
- For any real pilot later: add authentication, organization-level authorization, audit logs, encryption/key management, privacy review, and security testing.

## 8. Out of scope for 3–4 days

ML customer payment forecasting, arbitrary PDF/OCR, direct ERP/bank APIs, full accounting/GST/compliance, complex corporate group consolidation, invoice financing execution, reliable commercial cost estimation, multi-company production isolation, and RAG.

## 9. Definition of done

- Real CSV/XLSX import with preview and review, saved in MongoDB.
- Deterministic 90-day cash chart where every event is traceable and tests pass.
- Automated rescue planner that produces valid ranked actions **or explains why none exists**.
- Order analyzer computes an advance threshold based on a full date-dependent forecast.
- No double counting; no silent invented dates; explicit business assumptions.
- README explains setup and demo scenario; seed script and automated tests work.

See also: `TECH_STACK.md`, `DATABASE_ARCHITECTURE.md`, `API_CONTRACT.md`, `ACCEPTANCE_TESTS.md`, `AGENT_BUILD_PROMPT.md`.
