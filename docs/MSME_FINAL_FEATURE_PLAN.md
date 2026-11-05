# MSME Cash-Flow Action Engine — Final Feature Plan

Verified: 5 November 2026. Target: Indian B2B traders/distributors selling on credit, with regular supplier and operating payments.

**Decision:** Build a small cash-decision companion to existing accounting software. Help owners decide what they can spend, which collection matters today, and how to respond when an expected payment fails.

## 1. What the earlier gap analysis got right—and overstated

The attached document identifies useful owner problems. It does **not** establish that competing products lack solutions. “Zoho shows forecasts; we recommend actions” is also too broad: Zoho already documents actionable receivables insights.

| Proposed gap | Verified competitive position | Decision for our project |
|---|---|---|
| Unclear safe-to-spend cash | Zoho supports forecasts and assumptions; Agicap combines bank cash, receivables/payables, salaries, taxes and other commitments. Cash planning already exists. [Zoho forecasting](https://www.zoho.com/in/books/help/reports/business-overview.html), [Agicap](https://agicap.com/en-us/features/cashflow-forecast/) | Keep a simple spending limit tied to the lowest future balance, reserve and downside assumptions. Treat usability as the opportunity. |
| Delayed collections and broken promises | Zoho has expected-payment-date reminders and AI collection insights. Chaser explicitly reports payment promises and disputes; Float adjusts expected dates using payment history. [Zoho reminders](https://www.zoho.com/us/books/kb/reminders/rem-epd.html), [Zoho AI](https://www.zoho.com/in/books/help/ai-features/ai-features.html), [Chaser](https://help.chaserhq.com/generating-xlsx-reports-in-chaser), [Float](https://intercom.help/floatapp/en/articles/12579721-smart-expected-dates-for-invoices-bills) | Keep promise history **connected to affected bills and rescue-plan recalculation**. Promise tracking alone is established. |
| Unexpected shortages | Forecasting/scenarios are established in Zoho, QuickBooks, Xero and specialist tools. Cash Flow Frog even integrates with Zoho Books. [QuickBooks](https://quickbooks.intuit.com/learn-support/en-global/help-article/money-movement/cash-flow-planner/L8kvVEdNC_ROW_en), [Xero](https://apps.xero.com/us/collection/new-year-cash-flow-forecasting), [Zoho marketplace](https://marketplace.zoho.sa/app/books/cash-flow-frog-extension-for-zoho-books?src=marketplace-blog) | Keep shortage detection as the foundation; focus development on feasible actions and follow-through. |
| Manual bank investigation | Zoho documents AI field prediction, matching-status visibility and bulk categorization. This is not an unserved category. [Zoho banking update](https://www.zoho.com/blog/books/banking-enhancements.html) | Build only the import/payment exceptions needed to trust our cash plan. Defer a general reconciliation product. |
| Inventory purchases drain cash | Inventory Planner already provides purchasing recommendations and Open-to-Buy cash planning. This does not prove an exact salary/GST reserve optimizer, but disproves the broad absence claim. [Open-to-Buy](https://help.inventory-planner.com/en/articles/7837168-how-to-use-your-open-to-buy-plan), [Purchasing](https://www.inventory-planner.com/features/purchasing/) | Start with “Can I afford this proposed purchase?” Defer SKU-level quantity optimization. |

Indian competitors overlap too: [Vyapar](https://vyaparapp.in/videos/how-to-send-payment-reminder) documents SMS/WhatsApp reminders; [CredFlow](https://credflow.in/businesses) documents collection tracking, Tally/Busy access and bank reconciliation. Neither reminders nor accounting connectivity is a novelty claim.

**Another correction:** Zoho’s [project-billing FAQ](https://www.zoho.com/in/books/kb/time-tracking/proj-based-on-milestone.html) says milestone billing is unsupported, while its current [progress-invoicing guide](https://www.zoho.com/in/books/help/quote/progress-invoice.html) supports staged amounts/percentages and gives a construction-stage example. These are different workflows. Do not claim Zoho cannot handle staged billing.

**Evidence boundary:** This is a public-documentation review, not hands-on testing of every plan. Availability varies by edition, region and rollout. No evidence here justifies “no mainstream platform solves these issues.” The exact combined workflow below was not established in the reviewed documentation; that is a differentiation hypothesis, not proof of uniqueness or demand.

## 2. The final features to deliver

| Priority | Feature | Required owner-facing behavior | Why it matters |
|---|---|---|---|
| 1 | **Payment promises with cash consequences** | Record promised amount/date, partial promises, revisions, disputes and actual receipts. When a promise is missed, show affected essential payments, request a revised date and recalculate risk. | Turns a changing collection expectation into an immediate decision. |
| 2 | **Reserve-aware spending check** | Show available bank cash, protected commitments, lowest projected balance and an additional spending limit over 30 days. Include wages, owner-confirmed tax payments, supplier dues and unbilled commitments. Show expected and delayed-receipt cases. | Answers “Can I spend ₹50,000 today without crossing my reserve?” |
| 3 | **Rescue Planner linked to outcomes** | Compare up to three permitted combinations of earlier collection, agreed supplier extension and postponed optional spending. Show amount/date, known cost, affected bills and downside result. Recalculate after refusal, missed promise or partial receipt. | Makes existing simulations usable when real agreements change. |
| 4 | **New-order advance calculator** | Enter order receipts and dated costs; calculate the minimum advance needed to preserve the reserve across existing commitments. Test delayed final payment and explain when no feasible advance exists. | Prevents accepting work that the business cannot finance on the entered terms. |
| Foundation | **Trusted data and payment confirmation** | Preview imports, deduplicate, allocate partial receipts and show data age plus excluded amounts. Flag possible duplicates/unmatched receipts for review. Re-importing must not duplicate cash. | Every recommendation depends on accurate balances and outstanding amounts. |

The daily screen should show **spending limit → next reserve breach → three actions → unresolved data issues**. Keep the timeline and explanations one click away.

Spending-limit rule: for a proposed immediate cash outflow, use the smallest projected balance across the selected horizon, including today, minus the reserve, floored at zero. Calculate separately for expected and downside receipts. If essential outflows are missing/undated or the cash snapshot is stale, show an incomplete-data state instead of a confident “safe” result. Label all limits as conditional on dates and assumptions; daily closing balances do not establish intraday liquidity.

## 3. Extend what the project already has

Code inspected in `D:\el-sem-3`: the forecast already detects reserve breaches; Rescue Planner stores proposed/requested/agreed/rejected/completed statuses; New Order Analyzer already calculates minimum advances and delayed-payment scenarios. Collection follow-ups already have priorities and history, with demo drafts and a configurable n8n path whose live sending is not verified here.

The missing work is structured promise history, confirmed payment allocation, amount-based data warnings, a spending-limit view, and event-driven recalculation. Existing action-status updates alone do not confirm payment or update the cash ledger. Preserve hypothetical scenarios separately from actual receipts.

## 4. Build order and proof of usefulness

1. **Establish trustworthy inputs:** Start with one accounting-export format used by pilot owners plus bank CSV. Add import preview, duplicate handling, payment allocation and data-completeness checks. Before using real business data, add authenticated business access, server-side isolation and backups; the current README says authentication is absent.
2. **Complete the daily decision loop:** Add promise events, spending checks and the daily screen. A missed promise must update the forecast and invalidate affected saved plans.
3. **Connect existing decision engines:** Reuse Rescue Planner and New Order Analyzer; verify changes against actual payment outcomes. Agreed actions remain conditional until completed; do not treat a promise as cash received. Keep mandatory obligations protected and require explicit agreement for supplier extensions.
4. **Pilot with 3–5 owners in the chosen segment for four weeks:** Measure record-maintenance time, forecast-versus-actual differences, warning lead time, accepted/completed actions and repeated weekly use. Interview 10–15 owners before expanding scope. These are validation activities, not evidence that impact is already proven.

Acceptance examples: a missed ₹60,000 promise exposes the relevant wage shortfall; a partial receipt clears only its allocated amount; duplicate imports do not inflate cash; a rejected extension removes its projected benefit; an advance arriving after the shortage cannot be presented as a solution.

Defer full bookkeeping/GST filing, autonomous negotiation, SKU inventory optimization, pooled buyer scores, lending dossiers and dispute/legal automation. Use deterministic calculations for money; optional AI can explain results and draft messages.

**Product claim:** “Helps credit-selling MSMEs turn changing payment promises into spending decisions, practical cash-recovery plans and order-advance requirements.” Validate simplicity, maintenance effort and willingness to pay against the tools owners already use.
