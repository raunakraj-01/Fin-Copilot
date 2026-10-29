# CashFlow Copilot — Acceptance Tests & Demo Checklist

> The project's credibility depends on financial correctness. Test the **pure JS finance/rescue/order functions** with fixed date-only fixtures; do not rely on screenshots or chatbot output as proof.

## A. Mandatory finance tests (Vitest)

### A1. Opening balance and settlement are not counted twice
- Set `asOfDate=2026-11-01`, opening cash ₹2,00,000.
- Add a fully-paid ₹1,00,000 receivable with date in October.
- **Expected:** day-1 opening cash remains ₹2,00,000; no extra ₹1,00,000 receipt.

### A2. Partially paid invoice
- Invoice face value ₹4,00,000, already paid ₹1,00,000, expected future payment Nov 26.
- **Expected:** schedule only ₹3,00,000 on Nov 26. Reject an imported `settledPaise` larger than original.

### A3. Simple shortage timeline
- Opening ₹2,00,000 on Nov 1, no safety reserve.
- Nov 6: supplier bill ₹3,00,000.
- Nov 11: mandatory payroll ₹1,00,000.
- Nov 26: customer receivable ₹4,00,000.
- **Expected:** first negative day Nov 6 at **−₹1,00,000**; minimum −₹2,00,000 on Nov 11; after Nov 26 balance ₹2,00,000. All future dates must be present and in correct order.

### A4. Safety-buffer warning is separate from actual insolvency
- Opening ₹2,00,000, reserve ₹1,00,000, payment ₹1,50,000 on Nov 5.
- **Expected:** cash ₹50,000: below reserve, **but not negative cash**. Label as reserve breach, not cash below zero.

### A5. Uncertain overdue record
- Import open invoice due Oct 20 with no approved future expected date.
- **Expected:** needs-review warning; no silent predicted receipt on Nov 1.

### A6. Recurring rule
- Monthly rent ₹25,000 due on the 5th in a Nov–Jan window.
- **Expected:** one outgoing event on Nov 5, Dec 5 and Jan 5, without creating permanent duplicate cash items.

## B. Rescue planner tests

### B1. Correct early partial receipt and no duplicated money
- Use A3 timeline.
- Owner permits bringing ₹2,00,000 from the Nov 26 customer invoice forward to Nov 4.
- **Expected:** Nov 4 +₹2,00,000 and −₹3,000 action fee; Nov 26 now +₹2,00,000 (not +₹4,00,000); Nov 11 minimum cash = −₹3,000, a partial mitigation; original record unchanged by simulation.

### B2. No illegal payable deferral
- Payroll Nov 11 marked mandatory and non-negotiable.
- **Expected:** planner never proposes delaying payroll.
- A supplier bill marked non-negotiable must also be excluded.

### B3. Whole-horizon feasibility
- A plan delays a ₹3,00,000 bill from Nov 6 to Nov 15; money coming in only Nov 26.
- **Expected:** planner rejects plan if it merely shifts the shortage to Nov 15. Do not judge just the first alert date.

### B4. No double action / double collection
- Two candidate interventions reference the same invoice and would each accelerate the full outstanding amount.
- **Expected:** incompatible combinations rejected. Accelerated receipts cannot exceed outstanding.

### B5. Not all costs known
- Candidate A has ₹3,000 explicit fee; candidate B has unknown fee (`null`).
- **Expected:** do not label candidate B "free" or guarantee "globally cheapest". Return unknown-cost warning and a transparent ranking rationale.

### B6. No solution
- The only outgoing amount is unavoidable and no earlier cash inflow is permitted.
- **Expected:** `plans=[]` and an accurate "no feasible plan under entered constraints" explanation; optional explicitly labeled partial mitigations.

## C. New Order Analyzer tests

### C1. Minimum customer advance (isolated example)
- Opening cash ₹2,00,000 on Nov 1, required safety reserve ₹1,00,000, no other transactions.
- Proposed order sale ₹8,00,000; materials cost ₹5,00,000 paid Nov 11; advance arrives Nov 2; remaining balance arrives Dec 31.
- **Expected:** minimum advance **₹4,00,000** to maintain at least ₹1,00,000 at all times. An advance of ₹3,99,999 fails by ₹1; an advance of ₹4,00,000 works.
- Total eventual order receipt = ₹8,00,000 (advance + remaining), not ₹12,00,000.

### C2. Advance arrives too late
- Same example, but advance arrives Nov 12 (after Nov 11 material cost).
- **Expected:** no amount of advance rescues the Nov 11 cash breach; `possible=false` with an intelligible reason.

### C3. Baseline already negative
- Workspace forecast becomes negative before the proposed order creates any events.
- **Expected:** distinguish "existing shortage" from "new shortage introduced by this order". If minimum advance cannot cure the baseline, don't claim the order itself is necessarily bad.

### C4. Final receipt beyond 90-day horizon
- Set final collection date after forecast end.
- **Expected:** the system does not assume that cash arrived within 90 days; warns that the scenario has an out-of-horizon receipt.

### C5. Dates and Indian rupee formats
- Inputs such as `₹1,20,000` in mapped CSV column normalize correctly to paise; invalid dates like `2026-02-30` fail validation. UI shows `₹1,20,000`, API uses integer `12000000`.

## D. Import and API tests

- Valid CSV and XLSX lead to row preview, review/warnings, and commit.
- Re-importing the same source and invoice ID does not create duplicates; ambiguous collisions are shown, not silently overwritten.
- Invalid or missing required dates/amounts block commit until corrected or excluded.
- Files over 2 MB and >500 rows fail gracefully with clear messages.
- API returns correct 4xx error JSON, no fake success.
- CSV input cannot inject scripts into UI (React renders text safely; do not use dangerous HTML injection).
- Workspace not found -> 404.

## E. Demo story to record in README

1. Run MongoDB, API and React client.
2. Create synthetic packaging supplier with a known opening balance.
3. Import `fixtures/receivables.csv` and `fixtures/payables.csv` (or seed equivalent normalized items) and approve the rows.
4. Show date, amount and invoice/bill causes of projected shortage.
5. Run rescue planner, explain how a customer early-payment proposal would resolve or reduce the shortage **if the buyer agrees**.
6. Open order analyzer; input order ₹8 lakh, material cost ₹5 lakh, show conditional cash impact and minimum advance.
7. Adjust a constraint (e.g., supplier not negotiable), rerun, and show a different plan or "no feasible plan".
8. Show one import validation warning and corrected result.

## F. Evidence of completion

- `npm test` passes pure engine checks and representative API tests.
- `npm run build` in client succeeds.
- `npm run seed` creates usable synthetic sample data (repeatable/idempotent or documented reset).
- No UI cash value is static demo hardcoding once APIs are connected.
- UI can survive empty/new workspace with a useful empty state.
- Failures are explainable; no guarantee of buyer agreement or supplier consent.

## G. Scope priority if deadline threatens

1. Preserve pure forecast correctness and data import.
2. Preserve automatic F3 rescue planner and F4 advance analyzer.
3. Reduce fancy upload mapping UI to standard templates rather than compromising calculations.
4. Postpone tracker, OCR, LLM, complex recurring rules, and elaborate effects.

**Never remove validations to create a more optimistic financial demo.**
