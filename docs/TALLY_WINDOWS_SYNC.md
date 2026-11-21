# Windows Tally sync

CashFlow Copilot provides a PowerShell agent at [`client/public/tally-sync/CashFlow-TallySync.ps1`](../client/public/tally-sync/CashFlow-TallySync.ps1). The setup guide is available in Operations and at [`client/public/tally-sync/README.md`](../client/public/tally-sync/README.md).

The agent calls the business-scoped `POST /sync/batches` and `POST /sync/runs` APIs. Batch IDs and row versions make retries idempotent. The local state file tracks source IDs so deleted vouchers enter the review queue. Tally changes are stored as proposed/current values until the owner accepts or keeps the current record. Sync credentials are device-scoped and revocable.

Standard Voucher Register XML does not reliably represent outstanding amounts or due dates. Without the documented `CASHFLOW_*` fields, imported rows are flagged for owner verification and excluded from the forecast. The agent reads only local Tally XML; this version has no cloud bank connection and no shared buyer scoring.
