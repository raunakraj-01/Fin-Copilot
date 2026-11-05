# Rescue plans linked to outcomes

Open **Rescue Planner → Load saved plans**. The original saved cash calculation remains visible. A new **Current plan projection** rebuilds that plan from the latest workspace ledger and snapshot date on every request. After loading, the screen refreshes every 30 seconds while visible and on window focus. Action updates return the recalculated result immediately.

Each plan is an independent alternative, not a stack of adjustments to the main ledger. The main Cash Outlook continues to reflect recorded expectations and actual receipts; changing a plan's status does not post accounting transactions or settle invoices.

- **Agreed extensions:** Apply only to the remaining unpaid supplier/expense balance, subject to the current constraints. An agreed extension can remain effective after its original due date until the agreed new date. Known future estimated fees are included; unknown/past/undated fees require review.
- **Rejected extensions:** Lose their assumed benefit. If the old extension date was already copied into the cash record, this plan restores the original expected date. The owner should also review that source record.
- **Missed extensions:** Once the new date passes with an unpaid balance, the benefit is removed. Undated or overdue unpaid outgoing commitments are provisionally included on the next forecast day and marked for review, so the projection cannot silently hide them.
- **Collection promises:** Create the promise in Cash Outlook, then select it under **Linked payment promise** on the saved collection action and update. It must belong to that action's invoice. Promise receipts and expected installments are already in the forecast and are never added again by the rescue action.
- **Broken promises:** Follow the workspace as-of date. Their unpaid amounts remain excluded; the plan shows the broken-promise signal, the remaining gap and upcoming payments still exposed. Changing the workspace snapshot date causes detection at the next refresh.
- **Revised/cancelled promises:** Require review and explicit relinking to a replacement. Once relinked, the projection uses its actual current terms and displays changes from the original saved action.
- **Partial receipts:** Recalculate from current settled amounts and dated receipts. New invoice settlements reduce an unlinked collection action's remaining target, capped by outstanding cash. Linked actions use the promise's remaining balance. Confirmed receipts count once, including when a collection is split into accelerated and residual portions.
- **Completed:** An owner progress label, not payment evidence. Only cash records or promise receipts confirm payments. Proposed/requested/rejected actions do not add assumed benefits; already recorded receipts and independent promises remain in the underlying ledger forecast.

Action updates retain status/note/link history. Financial fields cannot be overwritten through the tracking endpoint. Original saved balances remain immutable; `GET /rescue/plans` and action PATCH responses add a freshly calculated `live` section with baseline/current cash, action outcomes, signals, warnings and affected payments. Reads do not write to the ledger or cached balances.

Legacy plans without starting settlement balances need verification when they contain partly settled invoices. Deletions, cancelled sources, changed constraints, external settlements and missing fees are shown as review conditions rather than silently accepted. A plan with unresolved conditions is labelled **needs review**, even when the included cash appears sufficient.

Use the existing payment tracker or verified payment flow to record actual receipts. Do not enter the same receipt again. Receipts on/before the cash snapshot must already be in opening cash. Existing synthetic-data and authentication limitations continue to apply.
