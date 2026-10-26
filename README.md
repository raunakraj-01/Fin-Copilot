# CashFlow Copilot

Student MVP for a synthetic Indian supplier's 90-day cash outlook. This branch implements the finance foundation. Rescue Planner and New Order Analyzer are being developed by Person 2 and currently show placeholders.

## Run locally

Use Node.js LTS. Start MongoDB Server locally or use a MongoDB Atlas URI. MongoDB Compass only inspects the database; it does not run the server.

1. Copy `server/.env.example` to `server/.env`; set `MONGODB_URI` and optionally `CLIENT_ORIGIN`.
2. Run `cd server && npm install && npm run seed` to create the repeatable synthetic demo workspace (`650000000000000000000001`).
3. Run `cd server && npm run dev` for the API at `http://localhost:5000/api`.
4. Run `cd client && npm install && npm run dev` for the app at `http://localhost:5173`.
5. Run `cd server && npm test` and `cd client && npm run build` to check the project. Tests use an isolated in-memory MongoDB, so they do not require your local database.

Open the UI and select **Use seeded demo workspace** to inspect seeded data. To exercise the import flow, create a new workspace dated `2026-11-01` with ₹2,00,000 opening cash and ₹0 reserve, then import and approve `fixtures/receivables.csv` and `fixtures/payables.csv`.

The fixture forecast first goes negative on **2026-11-06** and reaches **−₹2,00,000** on **2026-11-11**. The November 26 receipt brings cash back to ₹2,00,000 before later scheduled movements. These are entered-date scenarios, not guaranteed payment predictions.

## Finance API

- `GET /api/health`
- `POST /api/workspaces`; `GET/PATCH /api/workspaces/:workspaceId`
- `POST /api/workspaces/:workspaceId/imports/inspect` (multipart `file`, `kind`), `POST .../imports/:batchId/validate`, `POST .../imports/:batchId/commit`
- `GET/POST /api/workspaces/:workspaceId/items`; `PATCH/DELETE /api/workspaces/:workspaceId/items/:itemId`
- `GET/POST /api/workspaces/:workspaceId/recurring-rules`
- `GET /api/workspaces/:workspaceId/forecast?horizonDays=90`

All API monetary values are integer paise. Imports are reviewed before commit, repeated commits are idempotent, and imported source IDs do not overwrite existing records. The pure finance engine is `server/src/services/finance/forecast.js` with the agreed `buildForecast` and `explainRisk` exports. Person 2's modules can import these signatures and send default-exported routers/pages for shared integration.

This is a single-workspace demo without authentication. Do not upload real financial records or expose this API publicly.
