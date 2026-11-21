# Repository Guidelines

## Project Structure & Module Organization
CashFlow Copilot is a cash-planning MVP for Indian suppliers. `client/src/` contains React pages, reusable components, API/session helpers, translations, and CSS; `client/public/` holds static assets. `server/src/` contains Express routes, controllers, Mongoose models, validators, and domain services. Keep forecast calculations in `services/finance/forecast.js`; rescue and order services reuse that engine. Tests live in `server/tests/`, sample CSVs in `fixtures/`, and specifications in `docs/`.

## Build, Test, and Development Commands
Use Node.js LTS. Install dependencies separately with `npm --prefix server install` and `npm --prefix client install`.

- `npm run dev`: start the API with file watching on port 5000.
- `npm --prefix client run dev`: start Vite on port 5173 in another terminal.
- `npm test`: run the server-managed Vitest suite, including UI tests.
- `npm run build`: build the client into `client/dist/`.
- `npm run demo`: build and serve an isolated demo using temporary MongoDB; edits disappear on exit.
- `npm run db:check`: verify the configured database connection.

Copy `server/.env.example` to `server/.env` and configure `MONGODB_URI` for persistent local development.

## Coding Style & Naming Conventions
Follow surrounding JavaScript/JSX: two-space indentation, ES modules, semicolons, and predominantly single-quoted strings. Use PascalCase for React components and model files, camelCase for functions and variables, and descriptive feature filenames. No ESLint or Prettier configuration is present; keep formatting consistent manually. Represent money as integer paise and dates as `YYYY-MM-DD`.

## Testing Guidelines
Use Vitest, Supertest for HTTP assertions, and React Testing Library with jsdom for UI behavior. Name tests `*.test.js`, `*.test.mjs`, or `*.ui.test.jsx` under `server/tests/`. Run a focused suite with `npm --prefix server test -- tests/finance.test.js`. Database integration tests use isolated MongoDB instances; initial binary downloads may require internet. No coverage threshold is configured. Cover calculation boundaries, business isolation, and persistence; hypothetical plans must leave cash records unchanged.

## Commit & Pull Request Guidelines
History uses short, informal subjects such as `pages-endpoints`; no formal convention is established. Prefer concise, imperative subjects describing the change. PRs should explain behavior, link relevant issues, report test/build results, and include screenshots for UI changes. Consult `PARALLEL_WORK_CONTRACT.md` for ownership and shared-contract coordination.

## Security & Configuration
Keep credentials in ignored environment files and use synthetic test data. Preserve session authentication, CSRF checks, and business-scoped authorization on financial APIs.
