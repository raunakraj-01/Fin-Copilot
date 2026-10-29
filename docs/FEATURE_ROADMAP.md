# CashFlow Copilot: evidence-backed cash decisions

Planning date: 29 October 2026. First presentation: 30 October 2026. Follow-up milestone: approximately 29 November 2026.

Implementation update: the first milestone now includes dated rescue fees, Cash Shock Lab, collection impact cards and narrow AI-selected/source-backed explanations with a deterministic fallback. `README.md` describes the implemented behavior and demo launcher. The baseline findings and estimates below preserve the original planning context.

## Product direction

Help an Indian B2B supplier answer: **Which action protects payroll, what evidence supports it, and does it still work if a customer pays late?**

Focus on a packaging supplier/manufacturer already represented by the fixtures. Broader MSME coverage can follow. These are proposed features, not implemented capabilities or claims of globally unique invention.

## Existing foundation verified in source

- CSV/XLSX review and import, manual records, recurring expenses, integer-paise amounts.
- Shared daily forecast with source identifiers and assumption labels.
- Rescue search over bounded candidate combinations, with full-horizon feasibility checks.
- New-order evaluation, minimum advance search, delayed final-payment scenario.
- Saved hypothetical plans/scenarios and action status tracking.

Relevant implementation: `server/src/services/finance/forecast.js`, `server/src/services/rescue/analyze.js`, `server/src/services/orders/analyze.js`, `server/src/models/CashItem.js`, and the four existing client pages.

Limits that affect the roadmap:

- Expected collection dates are supplied by users; they are not learned predictions.
- CashItem has a cumulative settled amount but no dated settlement-event history suitable for payment-delay labels.
- Estimated rescue fees affect ranking but are explicitly not deducted from daily cash because their payment dates are missing.
- Marking an action agreed/completed does not reconcile underlying financial records.
- The current app is a synthetic demo without authentication.
- Rescue search is bounded; it does not prove a globally optimal solution.

## Why this direction

The Ministry of MSME reports 256,892 delayed-payment applications involving INR 55,244.31 crore through 31 December 2025. This is the amount involved in applications, not a current outstanding balance or the size of the entire market. [Ministry annual report 2025–26](https://msme.gov.in/sites/default/files/MSMEANNUALREPORT2025-26ENGLISH_0.pdf).

Generic forecasting, scenarios, and payment prediction already exist: [Zoho Books forecasting](https://www.zoho.com/au/books/help/reports/business-overview.html), [Float scenario planning](https://intercom.help/floatapp/en/articles/1719419-scenario-planning), and [Chaser late-payment prediction](https://help.chaserhq.com/predict-late-payments). The opportunity is a tightly integrated, evidence-backed decision workflow for a small supplier. This research does not establish patent novelty or exhaustive competitive uniqueness.

## Recommended features

### 1. Cash Shock Lab and resilient rescue plans — first priority

Select a customer and delay collections by 7, 15, or 30 days. Compare baseline and stressed cash, first reserve breach, shortfall, and days below reserve. Evaluate existing top rescue plans against the same scenarios and display which assumptions break each plan.

Tomorrow: one customer, three deterministic delay choices, before/after chart, and stress evaluation of the top three existing plans. Reuse buildForecast and applyActions. Stress any accelerated collection consistently; do not leave a negotiated receipt magically immune to the selected delay. Keep mandatory payments fixed. Preserve shifted receipts even if they leave the displayed horizon and show a warning.

Display “passes 2 of 3 selected stress scenarios,” never “67% probability of survival.” A scenario pass fraction is not a probability. Do not multiply the entire exponential rescue search by hundreds of simulations on an interactive request.

Month: uncertainty ranges learned from history, correlated delays for invoices from one customer, and a bounded search for plans that meet the reserve under all selected scenarios. If none does, show the additional buffer needed and the failing date.

### 2. Collection priority by cash impact — first priority

Answer “Whom should I call first?” For each permitted early collection, simulate its marginal impact on the cash timeline. Rank by shortage days removed and reduction in peak deficit; expose both metrics and any fee.

Tomorrow: reuse eligible rescue candidates and show three action cards with invoice, amount, latest useful collection date, cash impact, and a draft request. Rankings are conditional on successful collection; do not infer willingness to pay. Individual impacts are not additive—rerun the combined plan when selecting several actions.

Month: incorporate payment history and broken promises, then record whether a call led to an agreement and whether cash actually arrived. This connects recommendation, action, and measured outcome.

### 3. Evidence-backed copilot and document RAG — small slice tomorrow, full version next month

Tomorrow: three supported questions—“Why is cash short?”, “Which collection helps most?”, and “Why did this plan fail under stress?” Supply selected records and deterministic engine results to an LLM. Return source references and concise explanations. Keep financial numbers in server-generated result cards. On model failure, show the same results with template explanations.

This is structured grounding; do not advertise it as a trained model or a full document RAG pipeline.

Month: upload purchase orders, invoices, payment-term documents, and pasted customer commitments. Extract text with source/page metadata, split it into meaningful sections, and retrieve relevant passages with exact invoice matching plus semantic retrieval. Scope retrieval to the authorized workspace before ranking. Validate returned citation IDs and provide an “insufficient evidence” answer.

Example: “Can we request a milestone payment?” Retrieve a clause and show the source; propose a structured constraint for owner review; then run the forecast using the approved assumption. Documents never silently change cash records, and retrieved instructions cannot authorize tools or transactions.

Keep ledger arithmetic in database queries and the existing engine. RAG supplies evidence for terms and commitments. [Anthropic's contextual retrieval explanation](https://www.anthropic.com/research/contextual-retrieval) describes why exact identifiers and semantic retrieval can complement each other.

### 4. Negotiation envelope — month feature

Extend minimum-advance analysis into a small comparison grid: advance amount, final payment date, and optional early-payment discount. Highlight combinations that preserve reserve throughout the horizon, with their cost and assumptions.

The owner can answer “What terms should I offer?” instead of repeatedly filling out the same order form. Include dated discounts/fees and never label cash feasibility as proof of profitability. Start with a bounded grid, not a new optimizer dependency.

### 5. Which uncertainty should I resolve first? — month differentiator

For each unverified receipt, compare plausible timing cases. Rank the records whose uncertainty most changes the next decision. Example: confirming one small near-term receipt might determine whether payroll is covered, while confirming a larger later receipt may not change today's decision.

Start with a transparent sensitivity ranking. Do not call it formal expected value of information until credible probabilities and decision costs exist. This can reuse the Shock Lab and the current confidenceState field.

### 6. Payment-delay ML — conditional month extension

First add dated settlement events and stable counterparty IDs. Retain invoice issue/due dates, amounts, terms, payment events, and prediction snapshots. Define the target precisely, such as days from due date until full settlement. Unpaid invoices are unresolved outcomes, not zero-delay examples.

Start with customer median delay and a pooled fallback. If history is sufficiently representative, compare a small tabular model against those baselines using chronological holdouts. Features must be available at prediction time; final paid status and eventual settlement amounts cannot leak into them.

Report date error and, if producing intervals, interval coverage. Use payment scenarios with correlated customer delays to estimate cash uncertainty. Synthetic data can demonstrate the pipeline but cannot establish real-world accuracy. Do not fine-tune an LLM to predict cash balances.

## First milestone: 60% of the agreed scope

Treat this as a disclosed milestone weighting, not a measured completion percentage:

| Scope | Weight | Target |
| --- | ---: | --- |
| Existing import, forecast, rescue, order and tracking workflow | 35% | Verified and rehearsed tomorrow |
| Shock Lab and stress-test existing plans | 15% | Tomorrow |
| Collection priority and narrow grounded explanation | 10% | Tomorrow |
| Document retrieval, evidence and commitments | 15% | Month |
| Negotiation envelope and uncertainty prioritization | 10% | Month |
| History, baseline/model evaluation | 10% | Month, data dependent |
| Access control, integrated evaluation and final polish | 5% | Month |

The weights describe deliverables, not equal engineering effort. Present an item as complete only when it works end to end. Do not build unfinished tabs merely to imply completion.

## Deadline execution plan

Assume one developer familiar with this repo and an available model API credential. Budget 14–18 focused hours within the 1.5-day window, including rehearsal. Since the presentation is tomorrow, the presentation time is the actual cutoff; do not assume all 36 wall-clock hours are available.

| Work | Estimate | Completion gate |
| --- | ---: | --- |
| Baseline verification, fixed demo data and fee-date correction | 2–3 h | Fee reduces cash on its date; original fixture remains reproducible |
| Shock Lab + stress evaluation of three returned plans | 4–5 h | Changed dates affect results; original records unchanged |
| Collection-impact cards using existing candidates | 2–3 h | Rankings calculated by simulations; constraints respected |
| Narrow grounded copilot | 2–3 h | Source links; deterministic amounts; honest fallback |
| Tests, integrated UI cleanup, rehearsal and contingency | 4 h | Entire story runs twice from a reset workspace |

If behind: cut free-form chat first, retain supported question buttons and template explanations. Then narrow collection cards to existing plan actions. Keep the Shock Lab, correctness checks and rehearsal. A full RAG upload pipeline, OCR, custom ML, voice, and live messaging are outside the first milestone.

Implementation reach: forecast/rescue services and validators, their routes/controllers, Outlook and RescuePlanner, shared API calls, fee persistence if saved, fixtures, relevant unit/API tests and README. Keep one Express/Mongo application. No microservices or second frontend.

## Following month

1. Week 1: settlement/commitment history, fee accounting, authentication and workspace authorization before real uploads; collect consented historical data if available.
2. Week 2: document extraction/retrieval, citations, owner review of extracted terms; test unanswerable questions and cross-workspace isolation.
3. Week 3: negotiation grid and uncertainty prioritization; evaluate payment-delay baselines. Train a model only if the data supports meaningful evaluation.
4. Week 4: integrate, evaluate, fix, and rehearse. Compare baseline forecast vs stressed forecast, baseline collection order vs impact ranking, and uncited vs evidence-backed answers. Report measured results and synthetic-data limits.

If data collection or document extraction overruns, ship the baseline predictor and supported document types; do not sacrifice integrated testing to complete every extension.

## Five-minute demonstration

1. Load the synthetic packaging supplier dated 1 November 2026. Clearly label this as scenario time, not today's date.
2. Show the fixture's INR 200,000 opening cash, 6 November shortage and INR 200,000 peak deficit on 11 November.
3. Show the existing early-collection rescue. Before fees, collecting INR 200,000 by 4 November brings the 11 November balance to zero. Once dated fees are included, recalculate and explain why the plan may need additional headroom.
4. Delay the customer's payment and show the plan fail or weaken. Explain the exact broken assumption.
5. Show the highest-impact collection action and source-backed explanation. Select an alternative and rerun the full horizon; if no feasible rescue exists, report the required buffer honestly.
6. End with the order analyzer: calculate the advance required against the current workspace. The separate clean-workspace INR 400,000 example is not valid for every baseline.

## Whiteboard

Records -> validated ledger -> forecast and scenario engine -> ranked actions -> owner review -> outcomes.

Documents -> extraction and retrieval -> cited evidence -> owner-reviewed assumptions -> same engine.

Settlement history -> baseline/ML delay estimates -> scenario assumptions -> same engine.

The LLM explains evidence and proposes structured inputs. The tested engine owns financial arithmetic and feasibility.

## Later, beyond this month

Compare user-entered invoice-discounting quotes against negotiated collections, including dated fees. TReDS can finance eligible MSME receivables but requires participation, counterparty acceptance and financier processes; it is not an instant cash source the app can promise. [RBI TReDS FAQ](https://systemhealth.rbi.org.in/Scripts/FAQDisplay.aspx_Id%3D132.html).

Defer bank/ERP integrations, automatic collections and financing execution until there is an actual pilot and authorized access. Avoid a generic government-scheme chatbot or a credit score with no defensible labels.
