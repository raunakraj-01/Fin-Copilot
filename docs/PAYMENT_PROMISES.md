# Payment-promise tracker

Open **Cash Outlook → Payment promises**. Select an existing receivable, enter an installment amount and future promised date, and save. Multiple promises can cover an invoice, but their unpaid total cannot exceed its outstanding balance.

- **History:** Revisions supersede the previous promise and retain its terms, receipts, notes and status at revision. Enter the new *remaining* amount. Cancellation retains history and returns that portion to the invoice's original expected date.
- **Detection:** An unpaid promise becomes broken when its promised date precedes the workspace's **as-of date**. This deliberately uses the same snapshot as the forecast, not the wall clock. Advance the workspace snapshot in Setup & Import to evaluate a later day. A promise due on the snapshot date is not marked broken, but is excluded because the forecast only adds movements after the snapshot.
- **Forecast:** Future installments replace the corresponding portion of the invoice receipt. Unpromised balances retain the invoice expected date. Overdue promise portions are withheld until revised; they are never rolled forward automatically. Records marked needs-review remain excluded.
- **Affected payments:** For a future promise, the tracker shows outgoing payments whose daily closing balance would fall below reserve if that receipt failed to arrive during the horizon. For an overdue promise it shows upcoming outflows on days already below reserve. These are exposures, not allocation instructions or proof that a particular customer caused the shortage. Separate promise exposures must not be added together.
- **Actual receipts:** Use **Record payment** only for a new actual receipt. It reduces the invoice outstanding and unpaid promise atomically and adds a dated cash receipt. Retried submissions with the same request ID do not settle twice. Receipts on/before the snapshot must already be included in opening cash; recording one does not change the opening snapshot. Do not enter the same payment again using Already settled or another payment flow.
- **Other settlement methods:** Existing manual/gateway settlements still cap forecast receipts to the remaining invoice balance. A promise affected by an unallocated external settlement shows `review_external_settlement`; revise/cancel its remaining terms instead of recording the payment again.
- **Other analyses:** New-order and rescue baselines use the shared promise-aware forecast. Invoice-level early-collection rescue actions are excluded while unpaid promises exist; revise those installments directly. Cash Shock Lab shifts future promise dates with the selected customer's delay. Saved scenarios remain historical snapshots and require rerunning after changes.

The tracker follows the app's existing workspace scoping. It does not add tenant authentication; existing synthetic-data-only guidance still applies.

API under `/api/workspaces/:workspaceId`:

- `GET /promises`
- `POST /items/:itemId/promises`: `amountPaise`, `promisedDate`, optional `note`.
- `PATCH /items/:itemId/promises/:promiseId`: replacement remaining terms; preserves old history.
- `POST /items/:itemId/promises/:promiseId/cancel`: optional `note`.
- `POST /items/:itemId/promises/:promiseId/receipts`: `amountPaise`, `receivedDate`, UUID `requestId`, optional `note`.

`GET /forecast` includes `promiseRisks` with affected outgoing payments. Mutation conflicts return 409 and require refresh/retry. No migration is required for existing invoices.
