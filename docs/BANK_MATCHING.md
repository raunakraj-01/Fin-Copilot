# Reliable imports and bank-to-invoice matching

Open **Setup & Import → Bank receipts & invoice matching**. This version imports statements and matches **customer credits to receivable invoices**. It does not fetch live bank feeds or automatically match supplier debits.

## Invoice imports

CSV/XLSX imports retain inspect → map → review → commit. Source invoice IDs are compared across CSV, Excel and Tally-export formats within the business and receivable/payable category. IDs are normalized for case, whitespace and Unicode compatibility. Use a stable, business-wide source ID; if different customers use the same invoice number, qualify it before import.

Existing records are preserved, including settlements and promises. Duplicate IDs are skipped and changed duplicate amounts, dates, settlements or counterparties are reported for review. Re-imports do not silently update old records. Existing duplicates are not automatically merged or deleted.

Database identity constraints prevent concurrent duplicate inserts. A batch's reviewed rows become fixed when commit starts. Retrying the same interrupted batch resumes missing inserts and reports the total records saved by that batch. Changed corrections/exclusions during recovery are rejected. Committed batches return their saved summary on retry.

Amounts use exact integer-paise parsing with Indian/standard grouping and at most two decimal places. Ambiguous dates, missing source IDs, inconsistent statuses and duplicate IDs within a file must be corrected or excluded before commit.

## Bank imports

1. Download the bank statement template from the screen. Provide a stable **transaction ID**, **YYYY-MM-DD date**, description and separate positive credit/debit columns. Each row must contain exactly one positive credit or debit. CSV and XLSX are supported, up to 500 rows/2 MB per file.
2. Enter a consistent account name. Reusing that name is essential: transaction identity is scoped by business, account and bank transaction ID. Different accounts can legitimately reuse references.
3. Inspect, map the columns, validate, and correct/exclude flagged rows. Commit only after reviewing them.
4. Repeated and overlapping statement exports reuse existing transaction identities, even when filenames/formats differ. Changed details under the same reference are reported; existing bank data and match allocations remain intact.

Missing/ambiguous bank references are not invented. If a bank reuses a reference, supply its stable transaction-level ID or qualify it from bank evidence; do not assign different IDs merely to bypass a duplicate warning. Rows without trustworthy references need manual review.

Statement import alone does not post cash transactions. Unmatched credits, pending allocations and unreviewed debits appear in forecast warnings and block reserve-aware spending limits until resolved. These checks cover all imported rows, including older pages and receipts already represented in opening cash.

## Approve payment matches

Suggestions explain invoice-reference, amount and customer-name similarities. They are candidates, not proof of identity. **Use suggestion** fills the form; it never settles an invoice. Select the correct invoice, enter the amount, optionally allocate to a payment promise, and press **Confirm match**.

- A bank credit may be allocated in parts across multiple invoices. An invoice may receive multiple credits.
- The invoice becomes partly paid or fully paid according to its actual outstanding balance. Neither the bank's available credit nor the invoice/promise balance may be exceeded.
- Each allocation has an idempotency key. Retrying the same match does not record another receipt. Reusing a key with different details is rejected.
- The browser retains an uncertain submission's key for a retry in the same browser session, including screen remounts. Finish pending matches before creating another allocation on that bank credit.
- A pending allocation reserves its bank amount before invoice changes. If the request is interrupted, **Finish pending match** retries those exact details. It either confirms the already-recorded receipt or applies it once. Invalid matches release their reservation and retain a rejection reason. A pending match cannot be dismissed as reviewed.
- Confirmed receipt records protect against later deletion, category changes or settlement reductions that would erase their amounts. Conflicting source-sync updates are rejected for review.

Only match a receipt not already entered through Already settled, the promise tracker or a payment gateway. The app cannot reliably identify an independently entered duplicate payment without a shared reference. Suggestions never authorize that assumption.

## Forecast and related analyses

Matched receipts retain the actual bank date. After the cash snapshot, that dated amount enters the forecast once and only the remaining invoice balance stays expected. Receipts on/before the snapshot are assumed already included in opening cash, so matching them reduces outstanding expectations without adding that cash again. Matching never changes opening cash automatically.

Optional promise allocation records the corresponding partial receipt and history. Without it, existing promise-review checks identify externally settled amounts. Rescue projections read the updated ledger; saved order calculations become outdated when receipt or bank-review inputs change. Refresh the relevant screen to see updated results.

For debits, non-invoice income or other unmatched amounts, first verify their treatment in cash records/opening cash, then use **Mark unmatched amount reviewed separately** with a meaningful note. This review does not post another payment. Partly allocated credits retain their applied matches while the unmatched remainder can be reviewed separately. **Reopen for matching** reverses that review decision. Applied/pending/rejected match records and review notes remain visible.

Confirmed allocations have no automatic unmatch/reassignment endpoint in this version. Review the invoice carefully before confirming; corrections to already-confirmed matches require a separately designed reversal workflow. TDS, discounts, refunds and fees are not silently written off. A smaller bank receipt remains a partial payment until the remaining balance is explicitly accounted for.

## API and storage

Under `/api/workspaces/:workspaceId/bank`:

- `POST /imports/inspect`: multipart `accountKey`, `file`.
- `POST /imports/:batchId/validate`: column `mapping`.
- `POST /imports/:batchId/commit`: optional `corrections`, `excludedRowNumbers`.
- `GET /?offset=0`: rows, suggestions, allocation history and eligible invoices; 500 rows per page.
- `POST /:transactionId/match`: UUID `requestId`, `cashItemId`, integer `amountPaise`, optional `promiseId`.
- `PATCH /:transactionId/review`: `state` (`open`/`excluded`) and required `note`.

The existing standalone MongoDB is supported. Recovery uses durable bank reservations plus an idempotent atomic invoice update; interrupted cross-document acknowledgments remain visibly pending until retried. No payment is sent externally. Existing synthetic-data/authentication limitations remain unchanged.
