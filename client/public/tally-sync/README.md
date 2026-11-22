# Windows Tally sync agent

This agent sends Sales and Purchase vouchers from Tally's local XML server to one CashFlow Copilot business. It uses the business-scoped sync device token created in **Operations**. It does not send PAN or GSTIN values, and the token is encrypted with Windows DPAPI for the Windows account that initializes it.

## Setup

1. In CashFlow Copilot, open **Operations**, enroll a sync device, and copy the token once. Keep the token private.
2. On the accountant's Windows computer, save `CashFlow-TallySync.ps1` and run PowerShell as the same Windows user that will run the scheduled task:

   ```powershell
   powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\CashFlow-TallySync.ps1 -Initialize
   ```

3. Enter the API URL, business ID, stable Tally company ID, local Tally URL, and device token. The encrypted configuration and version state are saved under `%LOCALAPPDATA%\CashFlowCopilot`.
4. Ensure Tally is open and its local XML server is enabled at `http://127.0.0.1:9000`. Run once interactively:

   ```powershell
   powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\CashFlow-TallySync.ps1
   ```

5. If the preview is correct, register a 30-minute scheduled task for the current Windows user:

   ```powershell
   powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\CashFlow-TallySync.ps1 -InstallTask
   ```

The task runs only while that Windows account can read the encrypted config and Tally's local XML server is available. Revoke a lost device in **Setup & Import → Business access**.

## Tally fields and review

The default Voucher Register export provides voucher type, date, voucher number, party, and amount. Those records are imported as **needs review** because a standard voucher export may not show current outstanding balances or contractual due dates. They stay out of the forecast until the owner verifies them.

To allow the agent to mark a row verified, expose these custom XML values on each Sales or Purchase voucher:

- `CASHFLOW_AMOUNT`: full invoice amount in rupees.
- `CASHFLOW_SETTLED`: total received/paid in rupees, or `CASHFLOW_OUTSTANDING`: current outstanding amount in rupees.
- `CASHFLOW_DUEDATE`: due date in `YYYYMMDD` or `YYYY-MM-DD`.
- Optional `CASHFLOW_EXPECTEDDATE`, `CASHFLOW_INVOICENUMBER`, `CASHFLOW_PARTY` and, for a fully settled invoice, `CASHFLOW_CLEAREDDATE`.

Amounts are converted to integer paise. A complete paid record with a cleared date becomes same-business payment timing evidence. Changed amounts, dates, counterparty, or status are queued for owner review; deletions are also queued and never silently cancel ledger records. Backdated new vouchers are queued. Repeated batches are safe to retry.

For a parser-only smoke test, use the included synthetic export without contacting Tally or the API:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\CashFlow-TallySync.ps1 -InputXmlPath .\sample-vouchers.xml -ParseOnly
```

The API records the last successful sync, pending changes, and actionable agent errors on the **Operations** page. Do not use a shared sync token across businesses.
