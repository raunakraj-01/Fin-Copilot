# CashFlow Copilot — Tech Stack & Repository Layout

## Fixed rules

**Frontend:** HTML + CSS + JavaScript using **React.js**. **Backend:** **Node.js + Express**. **Database:** **MongoDB** managed/inspected through **MongoDB Compass**. No Python backend, SQL database, TypeScript migration, or unrequested framework swap.

**Vite is allowed only as the React development/build tool.** It does not replace HTML/CSS/JavaScript/React. Use `client/` and `server/`, not `frontend/` and `backend/`.

## Chosen libraries and rationale

| Layer | Choice | Rationale |
|---|---|---|
| Client | React (JavaScript) + Vite | Fast development, familiar structure, standard React UI |
| Visual styling | Plain CSS or Tailwind CSS; lightweight React Bits effects | Attractive UI; no need for another application framework |
| Charts | Recharts | Visualize daily balances and before/after scenarios |
| Forms / fetching | React state + Fetch API | Minimize dependencies; optional TanStack Query only if beneficial |
| Node API | Express | Straightforward REST endpoints |
| Validation | Zod or express-validator (choose one) | Reject malformed money, dates, CSV mappings, intervention constraints |
| Persistence | MongoDB + Mongoose | Flexible imported rows and scenario documents; Compass for inspection |
| CSV import | Papa Parse (`papaparse`) server-side or `csv-parse` | Structured CSV ingestion and row validation |
| Excel import | `exceljs` | Support `.xlsx` without additional office suites |
| Multipart uploads | `multer` with strict size limits | In-memory upload for structured files; no unbounded storage |
| Dates | `date-fns` + date-only helper functions, or custom UTC-safe date-only utilities | Deterministic Asia/Kolkata financial dates |
| Testing | Vitest (pure core engines), Supertest (API tests) | Catch arithmetic and API errors fast |
| Explanation (optional, Day 4+) | Gemini or comparable hosted LLM API on server only | Convert verified JSON into natural language; template fallback if absent |

**No RAG, vector database, training pipeline, LLM financial calculator, microservices, Redis, or message queue.** These create more risk than value under the deadline.

## Repository structure — build this

```text
cashflow-copilot/
├── client/
│   ├── public/
│   ├── src/
│   │   ├── app/App.jsx
│   │   ├── components/        # Navbar, MetricCard, CashChart, DataIssueBadge
│   │   ├── pages/             # SetupImport, Outlook, RescuePlanner, OrderAnalyzer
│   │   ├── services/api.js    # Only fetch wrappers and response parsing
│   │   ├── hooks/
│   │   ├── styles/            # Design tokens, layout and animation
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── .env.example
├── server/
│   ├── src/
│   │   ├── app.js             # Express setup, routes and error middleware
│   │   ├── index.js           # Server start and MongoDB connection
│   │   ├── config/db.js
│   │   ├── models/            # Mongoose models
│   │   ├── routes/            # workspaces, imports, items, forecast, rescue, orders, plans
│   │   ├── controllers/
│   │   ├── services/imports/  # CSV/XLSX adapters + validation + mapping
│   │   ├── services/finance/  # Pure forecast/event builder, risk explanations
│   │   ├── services/rescue/   # Generate candidates, apply, score combinations
│   │   ├── services/orders/   # Order event injection and advance search
│   │   ├── validators/
│   │   ├── utils/money.js     # Integer-paise conversion and format helpers
│   │   ├── utils/dates.js     # YYYY-MM-DD financial date helpers
│   │   └── seed/             # Synthetic workspace and cases
│   ├── tests/
│   ├── .env.example
│   └── package.json
├── fixtures/
│   ├── receivables.csv
│   └── payables.csv
├── docs/                    # Place the supplied Markdown specifications here
├── .gitignore
└── README.md
```

## Environment variables

`server/.env.example`:

```dotenv
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/cashflow_copilot
CLIENT_ORIGIN=http://localhost:5173
NODE_ENV=development
# Optional only: LLM_API_KEY= (never commit actual value)
```

`client/.env.example`:

```dotenv
VITE_API_BASE_URL=http://localhost:5000/api
```

## Startup contract

- `cd server && npm install && npm run dev`
- `cd client && npm install && npm run dev`
- `cd server && npm test`
- `cd server && npm run seed` for deterministic synthetic demo records
- README must include the exact tested commands, Node LTS recommendation, and expected local URLs.
- MongoDB Compass is an optional desktop viewer that connects to the same local `MONGODB_URI` instance; **Compass alone cannot run MongoDB**. The user must have MongoDB Server running or use Atlas.

## API/algorithm boundaries

- `client` sends inputs, displays returned values, and never performs authoritative financial arithmetic.
- `server` validates all submitted amounts and dates, runs deterministic pure functions, saves approved records, and returns traceable calculations.
- Return all money fields as **`*Paise` integer** in API JSON; UI formats with `Intl.NumberFormat('en-IN', { style:'currency', currency:'INR' })` after converting paise to rupees.
- Avoid inventing payment forecasts when no expected date is supplied. User must verify uncertain entries before they affect approved forecast.
- File import may be a staged preview/commit flow; avoid direct blind insertion.

## LLM and RAG decision

**Ship without an LLM first.** Explain a rescue recommendation with deterministic template strings generated from actual structured results. If the core works and time remains, optionally call an LLM to *rewrite* the approved explanation into accessible language. Provide only minimal relevant structured input, label it synthetic/demo, and never include secrets or raw bank statements.

**Do not use RAG.** The prototype works on structured records, not a document-retrieval knowledge base. A vector search adds complexity without improving numerical correctness.

## Delivery order

1. Engine + tests + seed records.
2. Import/review + forecast API and chart.
3. Automatic rescue API and UI.
4. New order scenario API and UI.
5. Polishing, tracking, optional LLM.

**Do not trade a working financial engine for ornamental React Bits animations.** Keep effects subtle, performant and compatible with React JavaScript.
