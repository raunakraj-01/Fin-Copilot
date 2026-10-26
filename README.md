# CashFlow Copilot

Student MVP for a synthetic Indian supplier's cash forecast and scenario planning. This repository is the shared skeleton; finance/import and rescue/order features are built on separate branches.

## Run locally

Use Node.js LTS and run MongoDB Server locally or provide an Atlas URI. MongoDB Compass only inspects the database; it does not run the server.

1. Copy `server/.env.example` to `server/.env` and set `MONGODB_URI`.
2. Run `cd server && npm install && npm run dev` for the API at `http://localhost:5000/api`.
3. Run `cd client && npm install && npm run dev` for the app at `http://127.0.0.1:5173`.
4. Run `cd server && npm test` for the forecast contract tests.

`GET /api/health` responds with `{ "ok": true }` after MongoDB connects. Rescue and order routes currently return `501 NOT_IMPLEMENTED`. The workspace, import, item and forecast endpoints are the next finance branch work.

The provided CSVs in `fixtures/` are synthetic demo data. No authentication is present; do not use real financial records.
