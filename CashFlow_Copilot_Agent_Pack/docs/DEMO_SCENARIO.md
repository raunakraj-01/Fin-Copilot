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
- A rescue candidate can request collecting ₹2,00,000 of invoice `INV-R100` by **Nov 4**. If accepted and paid, Nov 11 balance reaches **₹0** rather than −₹2,00,000. Final Nov 26 expected receipt becomes **₹2,00,000**, not ₹4,00,000.
- A supplier extension may be proposed for `BILL-P200`, but check the ENTIRE future horizon; merely moving the shortage to a later day is not a successful rescue.

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
