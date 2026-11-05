# Reserve-aware spending check

Open **Cash Outlook → How much can I spend?** Choose a 7/30/60/90-day period and a 7/15/30-day customer-payment delay. Default: 30-day period, 7-day delay.

Confirm that all wages, tax payments, supplier bills, loan payments and other commitments are entered for that period. Use Setup & Import for missing records, including unbilled commitments entered as expenses. Confirmation is local to this screen and resets on a business, horizon or promise/ledger-refresh change. It is an owner assertion, not a bank-feed or completeness verification.

The screen shows:

- **Expected payments:** Additional cash that can be spent immediately while retaining the reserve on every day of the expected forecast.
- **Delayed payments:** The same check after shifting all future unconfirmed customer receipts—including promise installments—by the selected delay. Outgoing payments and confirmed dated receipts keep their dates. Missed promises remain excluded until revised.
- **Limit for both scenarios:** The smaller of the two limits. When the existing plan already breaches reserve, it says there is no additional spending room rather than suggesting that spending zero fixes the existing shortage.
- **Proposed spending:** Enter an amount to see whether it preserves the reserve in each scenario, the lowest resulting balance and the first breach date.

The calculation is `max(0, minimum daily closing cash − minimum reserve)`. The minimum includes the cash snapshot day, preventing later receipts from funding an immediate payment before that cash arrives. The period includes the snapshot day; a 30-day period ends 29 days after it. Limits are conditional on the entered data and daily timing, and do not establish intraday liquidity or affordability beyond the selected period. Moving a receipt beyond the period excludes it from that scenario's available cash.

## Incomplete data

The service withholds both spending limits (`null`, not zero) when:

- The cash snapshot is older than today's India date or dated in the future.
- The owner has not confirmed upcoming commitments.
- An outstanding record needs verification, has no expected date, or has an overdue/snapshot-day residual amount without a future date.
- Promise amounts need review following an external settlement/balance change.

Issues identify the record and amount excluded. Due/broken promise amounts are separately flagged, but do not block a calculation by themselves: their receipt amounts are conservatively excluded from both scenarios. Fully scheduled promise installments do not require an additional invoice expected date. Paid/cancelled records are not reported as missing commitments.

Cash freshness is based on the workspace **as-of date**, evaluated in **Asia/Kolkata**. Saving a fresh date must be accompanied by checking the actual opening cash balance. Actual receipts on/before that snapshot must already be included in opening cash.

The check reads existing records and never changes the ledger, reserve, saved plans or promises. Existing synthetic-data guidance still applies.

## API and verification

`GET /api/workspaces/:workspaceId/spending-check`

Optional strict query parameters: `horizonDays` (7/30/60/90), `delayDays` (7/15/30), `spendPaise` (safe nonnegative integer), `commitmentsConfirmed` (`true`/`false`). There is no client override for the evaluation date.

Response includes expected/delayed limits, included cash movements, proposed-spend results, horizon dates, assumptions, and structured completeness issues with excluded receipt/payment totals. Workspace scoping follows the existing app; this feature does not introduce authentication.

Tests cover the current-day ceiling, exact one-paisa threshold, reserve breaches, missing/overdue/unverified records, installments and actual receipts, receipts delayed beyond the horizon, recurring obligations, snapshot freshness across midnight IST, validation, read-only behavior, workspace isolation and stale UI responses.
