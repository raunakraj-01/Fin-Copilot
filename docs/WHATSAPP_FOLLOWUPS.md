# Proactive WhatsApp collections

Operations now recommends overdue invoices, invoices due within seven days of the workspace snapshot, and evaluated early collections that reduce the peak cash gap. Recommendations update when Operations opens and every 15 seconds while the page is visible. They use the current workspace ledger, permitted collection limits, dated fees and deterministic forecast. No language model controls financial amounts or sends messages.

## Presentation demo

1. Open Operations → Proactive collections & follow-ups.
2. Review the suggested customer, invoice, reason and draft. Enter a test phone number with country code to open a WhatsApp draft manually, without Razorpay.
3. Choose an open invoice, phone number, cadence (default three days), and maximum follow-ups (default three). Leave mode at **Local demo · drafts only**.
4. Click **Schedule follow-ups**. The first local draft is generated within 15 seconds while the backend is running. Refresh priorities to see it, or use **Run demo cycle now** to demonstrate a cycle immediately.
5. Expand Follow-up history. Subsequent drafts use progressively stronger follow-up wording and the latest outstanding amount. Demo cycles count draft generation, not message delivery. No WhatsApp API is called in demo mode.
6. Pause the rule, reach its attempt cap, or mark the invoice paid in Setup & Import. Before its next cycle, the worker rechecks the invoice and stops if it is paid, cancelled, missing, fully settled or needs review. Returning to Operations reloads current data.

Schedules use the real system clock, displayed in IST. Draft text and overdue status use the workspace as-of date, which is deliberately fixed in the synthetic demo. The backend must remain running. `npm run demo` uses a temporary database, so demo schedules disappear when that process is restarted, like other demo edits.

## n8n workflow

Import [the workflow JSON](../client/public/workflows/cashflow-followups.n8n.json) into n8n. It is saved inactive. The workflow is provided for configuration; it has not been executed against an n8n or WhatsApp Business account in this workspace.

Flow: Every minute → Claim due jobs → Split jobs → Recheck outstanding invoice and one-time dispatch permission → Send approved WhatsApp template → Record the API result.

1. Configure a WhatsApp Business Cloud account and obtain a phone number ID, access token, and approved utility template. The template must accept exactly one body text parameter containing the generated reminder, and its name/language must match the Configuration node. Follow [n8n's WhatsApp Business documentation](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.whatsapp/).
2. Create two **Header Auth** credentials in n8n. Both use header name `Authorization`, with a value starting `Bearer `. The CashFlow credential uses a per-business automation credential created by the owner; the WhatsApp credential uses the Meta access token. Select the appropriate credential on every HTTP Request node. No secrets are embedded in the export.
3. In the Configuration node set the backend base URL and Meta Messages URL, including the correct phone number ID and a supported Graph API version. Native local n8n can use `http://localhost:5000`. A Docker instance may need `http://host.docker.internal:5000` and a backend reachable from that container; the demo binds to localhost, so prefer native local n8n for this project. A hosted n8n instance cannot reach your localhost directly.
4. Create an automation credential under the selected business’s Setup & Import → Business access and use it as n8n’s CashFlow credential. Shared environment automation tokens are no longer accepted. Set `FOLLOWUP_ALLOW_SEND=1` only when ready to enable external sends, and restart the backend. These variables are read on the server, never in the browser. Login and business membership are required; use synthetic records while validating the full integration.
5. In Operations explicitly schedule a rule in **Automatic WhatsApp via n8n** mode and confirm that this particular recipient opted in. Creating a demo-mode rule never makes it eligible for n8n sending. The first live cycle is eligible immediately; later cycles use the configured cadence.
6. Review the imported nodes and credentials, then [publish the schedule-triggered workflow](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/). Start with a WhatsApp test recipient.

The app atomically claims each cycle, rechecks the invoice immediately before dispatch, grants dispatch permission once per claim, and consumes acknowledgement callbacks once. A paid invoice is excluded at the next eligibility check. There is a small unavoidable race if the invoice is paid or the rule is paused after final permission but before the external API receives the message. Pausing cannot recall an in-flight message.

`accepted` means the WhatsApp API returned a message ID; delivery/read receipts and reply interpretation are not implemented. `failed` pauses the schedule. External claims with no result after ten minutes also pause, rather than automatically resending an uncertain message. Inspect n8n/provider history before resuming by explicitly scheduling again. The imported send node has automatic retries disabled. At most five cycles can be configured per schedule, with a minimum one-day cadence.

This is a rule-driven proactive assistant with a bounded follow-up state machine. It does not autonomously negotiate discounts, infer payment from a chat reply, or change the ledger. Existing Razorpay settlement and manual ledger edits remain the payment evidence sources.

## Server endpoints

- `GET /api/workspaces/:workspaceId/followups`: current priorities, eligible invoices and schedules; signed-in business owner required.
- `POST /api/workspaces/:workspaceId/followups`: schedule or explicitly restart an eligible invoice's follow-ups.
- `PATCH /api/workspaces/:workspaceId/followups/:ruleId`: pause using `{ "state": "paused" }`.
- `POST /api/workspaces/:workspaceId/followups/:ruleId/demo-run`: advance one active demo schedule immediately; never sends externally.
- `POST /api/followup-automation/claim`: n8n claims due live jobs.
- `POST /api/followup-automation/jobs/:claimId/validate`: rechecks invoice and consumes one-time dispatch permission.
- `POST /api/followup-automation/jobs/:claimId/ack`: records `{ "outcome": "accepted", "providerMessageId": "..." }` or `{ "outcome": "failed" }`.

All automation endpoints require a revocable per-business automation credential in the `Authorization: Bearer` header and the explicit live-send switch. Default configuration disables the entire external automation API.
