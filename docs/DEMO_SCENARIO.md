# CashFlow Copilot — Seeded Demo Story

This example is intentionally **synthetic**; no accuracy claims about real supplier data are implied.

## Setup

- Workspace: Demo Packaging Supplier
- Fixed test as-of date: `2026-11-01`
- Starting available bank cash: **₹2,00,000** (`openingCashPaise=20000000`)
- Minimum reserve in initial rescue demo: **₹0** (change to show threshold sensitivity)
- Upload `fixtures/receivables.csv` and `fixtures/payables.csv` and map headers to canonical fields. **No bank integration required.**

## Expected core narrative

- **Nov 6:** ₹3,00,000 supplier bill comes due -> projected balance **−₹1,00,000**.
- **Nov 11:** ₹1,00,000 payroll -> worst projected balance **−₹2,00,000**.
- **Nov 26:** ₹4,00,000 customer collection expected -> cash recovers to **₹2,00,000** before later bills.
- A rescue candidate can request collecting ₹2,00,000 of invoice `INV-R100` by **Nov 4**. Its ₹3,000 estimated fee is deducted on Nov 4 by default, so Nov 11 balance reaches **−₹3,000** rather than −₹2,00,000. This action alone is a partial mitigation. Final Nov 26 expected receipt becomes **₹2,00,000**, not ₹4,00,000.
- A supplier extension may be proposed for `BILL-P200`, but check the ENTIRE future horizon; merely moving the shortage to a later day is not a successful rescue.

## Cash Shock Lab walkthrough

1. Run `npm run demo` at the repository root; use the seeded demo workspace. Dates are synthetic scenario dates.
2. Select Acme and a seven-day delay. The baseline's peak gap is ₹2,00,000 over 20 shortage days; the delayed forecast's gap is ₹2,50,000 over 27 days.
3. The baseline's least-known-cost plan defers BILL-P200 to Nov 26 and charges ₹2,000 that day. It fails under an Acme delay. The plan combining that extension with early collection has ₹1,45,000 baseline minimum cash after both fees, but a seven-day delay leaves a ₹55,000 gap. Both portions of Acme's receipt shift.
4. Collection priority shows INV-R100: ₹2,00,000 requested for Nov 4, ₹1,97,000 peak-gap reduction, five shortage days removed, and ₹3,000 still missing after fees. These benefits are against the original forecast.
5. Ask each of the three explanation questions. Without configured AI, the calculated fallback is explicit. Follow a source link to the highlighted record row.
6. Change the delay or customer; prior results clear until the next calculation. Orbit delays leave the first two displayed baseline plans passing all three selected delays; this is a scenario count, not a success probability.

No record changes occur during analysis. Unknown fees, owner-entered dates and counterparties' agreement remain explicit assumptions. Existing saved plans are historical snapshots; reanalyze them for the new fee treatment.

## Order evaluation story

For a clean standalone acceptance test (do not mix with the shortfall demo), use a workspace with:
- Opening cash ₹2,00,000, reserve ₹1,00,000, **no other transactions**.
- New order value ₹8,00,000; material cost ₹5,00,000 paid Nov 11.
- Customer advance arrives Nov 2 and remaining amount arrives Dec 31.
- Engine should find **₹4,00,000 minimum advance** to preserve the reserve over all dates.

If evaluating the SAME proposed order inside the existing shortage workspace, the minimum advance **must be recomputed against that baseline**; it will not necessarily be ₹4,00,000. Be careful not to hardcode demo answers.

## Messaging to user

- "This forecast assumes the entered expected payment dates."
- "Rescue actions require agreement and successful execution."
- "Minimum customer advance is conditional on the complete current cash plan and order payment schedule."
