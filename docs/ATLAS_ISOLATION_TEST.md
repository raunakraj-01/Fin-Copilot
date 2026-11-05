# Owner/accountant isolation test — 5 November 2026

Tested the running `npm run dev` API at http://localhost:5000/api, with the frontend at http://localhost:5173 and the configured Atlas database. Demo mode was disabled. All **200 live HTTP requests** matched their expected status; all **11 check groups** passed. Fixtures were created through the actual authenticated API, then confirmed in the configured Atlas database.

| Check | Result |
| --- | --- |
| Four separate account registrations and explicit logins | Passed |
| Wrong password, signed-out session and anonymous access | Rejected with 401 |
| Accountant invitation bound to email and single use | Passed; wrong email/reuse rejected |
| Business and invoice lists | Each account saw only its assigned business |
| Accountant bookkeeping, promises and saved order analyses | Allowed in their own business |
| Accountant settings, deletion, access management and integrations | 18 attempts rejected with 403 |
| Cross-business reads/writes and foreign invoice/order IDs | 108 attempts rejected with 404 |
| Forged business/owner headers | Did not grant access |
| Missing CSRF token | Mutation rejected with 403 |
| Denied attacks | Did not change either business's saved records |
| Accountant removal | Existing session lost business access immediately |

After the removal test, Accountant A was re-invited and access was restored for manual testing. All four automated sessions were logged out. No existing business records were edited.

## Retained fabricated businesses

| Business | Opening cash | Receivable | Expense | Forecast closing cash after entered movements |
| --- | ---: | ---: | ---: | ---: |
| Atlas Fabricated A 2026-11-05-c5c38a69 | ₹1,00,000 | ₹50,000 | ₹10,000 | ₹1,40,000 |
| Atlas Fabricated B 2026-11-05-c5c38a69 | ₹2,00,000 | ₹80,000 | ₹10,000 | ₹2,70,000 |

Each business also has a ₹10,000 payment promise, a ₹10,000 cash reserve, one saved hypothetical order analysis, its own owner and its own accountant. The shared external invoice reference `INV-001` intentionally exists in both businesses; their records and internal IDs remain separate. The hypothetical order does not post cash to the ledger.

The local login sheet is [LOGIN_DETAILS.md](../tmp/atlas-isolation/2026-11-05-c5c38a69/LOGIN_DETAILS.md). It contains generated test passwords and is excluded from Git. The [machine-readable results](../tmp/atlas-isolation/2026-11-05-c5c38a69/report.json) are stored beside it. Do not commit or publish the login sheet.

## Try the accounts yourself

1. Open http://localhost:5173 in a normal browser window and sign in as Owner A using the login sheet. Select Business A from the business menu. Its invoice should be **Customer A private**, with ₹50,000 outstanding.
2. Open an Incognito window or a different browser profile and sign in as Owner B. Select Business B; its invoice should be **Customer B private**, with ₹80,000 outstanding. Each business menu should contain only that account's business.
3. Sign out of the Incognito window and sign in as Accountant A. Choose Business A. Edit an invoice description and check the forecast. The business settings save button should be disabled, Business access should be hidden, and Operations should state that owner access is required.
4. In the owner window, open Setup & Import → Business access. Remove Accountant A. Refresh the accountant window: Business A should disappear. Re-invite the accountant and open the new invitation in their window to restore access.
5. Repeat with Accountant B for Business B. If manually editing amounts, the original forecast figures above will change accordingly.

Tabs within one browser profile share a login cookie. Use different profiles/browsers or normal and Incognito windows for simultaneous independent sessions; two normal tabs are not two independent accounts.

The automated test also submitted foreign business IDs and foreign child IDs directly to the API, rather than relying on the business selector being hidden. HTTP API behavior was tested live; the browser walkthrough is for your manual use.

## Repeat the live test

With the normal backend/frontend running and Atlas configured, run from the repository root:

```powershell
npm run test:atlas-isolation
```

This creates a fresh, separate set of four fabricated accounts and two businesses, runs the checks, then removes only that run's fixtures. To keep a new set for manual use, add `-- --keep-fixtures`. Each run writes its own local report and, when retaining successful fixtures, a login sheet under the Git-ignored `tmp/atlas-isolation/` directory. Normal registration/login rate limits apply; do not run this repeatedly in a loop. A failed run attempts to remove its own fixtures. If the network or process fails during cleanup, inspect the run identifier printed by the script before retrying.
