# Saved order analyses: freshness and recalculation

Open **New Order Analyzer → Load saved scenarios**.

- **Outdated analysis** appears when recorded cash inputs no longer match the saved calculation. This includes invoice/bill changes, partial settlements, actual receipts, payment promises, recurring payments, opening cash, reserve, snapshot date and forecast horizon. Storage timestamps, audit notes and row ordering do not create false change alerts.
- **Recalculate with current ledger** runs the saved order's original terms against the latest recorded inputs, updates the saved minimum advance and warnings, and retains the previous result in **Previous calculations**. The latest 50 previous calculations are kept. The order terms are preserved and no accounting entries are posted.
- **Edit order inputs** loads the saved terms into the main form, including costs and the delay setting. Correct dates or other terms, analyze, then save a separate scenario. If advance/cost dates no longer follow the workspace cash snapshot, recalculation is disabled until the terms are corrected. Dates are never moved forward automatically.
- Loaded lists check freshness every 30 seconds while visible and on window focus. Recalculation replaces that row immediately; older background responses cannot overwrite the new result.
- Older saved scenarios without an input fingerprint are marked outdated until recalculated. Their old results remain visible as historical amounts. Older versions did not retain the delay setting; those records use zero unless edited to restore the intended stress test.

New saves retain `delayedCollectionDays`, the calculation time, and a versioned fingerprint of forecast inputs plus order terms. The saved minimum advance remains the **expected-payment** threshold; the delay scenario tests the proposed advance using the saved delay setting. Freshness means the recorded inputs match, not that dates, collections or ledger completeness are guaranteed. Date checks follow the workspace as-of date, consistent with the rest of the app.

`GET /api/workspaces/:workspaceId/orders/scenarios` adds a `freshness` object to each saved scenario. This read does not recalculate or write monetary results.

`POST /api/workspaces/:workspaceId/orders/scenarios/:scenarioId/recalculate` accepts an empty JSON object. Monetary output and replacement terms cannot be supplied through this endpoint. It calculates on the server, checks for changed cash inputs before saving and uses optimistic concurrency for the saved scenario. Conflicts return 409 for refresh/retry. The response checks freshness again after writing so a further ledger change is reported rather than silently presented as current.

No migration is required. Bump the fingerprint version if future forecast-calculation changes should invalidate earlier results. Existing synthetic-data and workspace-authentication limitations continue to apply.
