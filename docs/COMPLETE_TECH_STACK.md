# 🛠️ Hisaab Platform: Complete Production Tech Stack Specification
### Comprehensive Technical Architecture & Component Directory

**Release Target:** Enterprise Production / Cloud Run / Multi-Container Docker  
**Runtime Environment:** Node.js 20+ LTS  
**Mathematical Base Unit:** Integer Paise (`1 INR = 100 Paise`)

---

## 1. Architectural Topology Overview

```
                                      CLIENT TIER
                 ┌───────────────────────────────────────────────────┐
                 │             React 19 + Vite 7 Frontend            │
                 │  • Landing Page & 1-Click Interactive Personas    │
                 │  • Dark / Light Theme Engine (CSS Custom Vars)    │
                 │  • Recharts 3.x Responsive Forecast Visualizer    │
                 │  • Printable A4 CA Executive Health Dossier       │
                 │  • Mobile-First Bottom Navigation (< 768px)       │
                 └─────────────────────────┬─────────────────────────┘
                                           │
                                    REST / JSON / SSE
                                           │
                                      SERVER TIER
                 ┌─────────────────────────▼─────────────────────────┐
                 │             Express 4.21 Application Gateway      │
                 │  • Rate Limiting & Input Validation via Zod       │
                 │  • Tally Prime / ERP 9 CSV & XLSX Import Parsers  │
                 │  • Pure Forecast & Risk Assessment Engine         │
                 │  • Non-Destructive Rescue & Order Simulators      │
                 └─────────────┬───────────────────────┬─────────────┘
                               │                       │
                     NATIVE DATABASE             AI AGENT LAYER
                 ┌─────────────▼────────┐ ┌────────────▼─────────────┐
                 │ MongoDB 7 (Mongoose) │ │ Google Gemini 1.5 Flash  │
                 │ • Persistent Storage │ │ • Grounded Tool Calling  │
                 │ • Auto-fallback to   │ │ • Bilingual NLP (HI/EN)  │
                 │   In-Memory Engine   │ │ • Deterministic AST Fallback│
                 └──────────────────────┘ └──────────────────────────┘
```

---

## 2. Frontend Technology Stack (`client/`)

| Layer | Package / Technology | Version | Purpose & Architectural Rationale |
| :--- | :--- | :--- | :--- |
| **Framework** | **React** | `^19.2.0` | Concurrent rendering, modern hooks (`useTransition`, `Suspense`, lazy loading of heavy views). |
| **Build Tooling** | **Vite** | `^7.1.9` | Ultra-fast HMR (<80ms), optimized Rollup bundle pipeline with manual vendor chunking. |
| **Data Visualization** | **Recharts** | `^3.2.1` | SVG-based responsive area charts for daily cash runways, reserve thresholds, and before-and-after rescue comparisons. |
| **Iconography** | **Lucide React** | `^1.62.0` | Lightweight tree-shakeable SVG icons for navigation, status badges, and financial metrics. |
| **Styling Architecture** | **Vanilla CSS + Modern CSS Variables** | Native | Zero CSS-in-JS overhead; instantaneous theme switching (`.app.dark` / `.app.light`); `@media print` rules for A4 PDF export. |
| **Typography** | **Google Fonts** | Hosted | Pairing *Space Grotesk* for high-legibility tabular financial figures and *Plus Jakarta Sans* for UI elements. |

### Client Bundle Optimization Configuration
To eliminate browser bundle latency, [`client/vite.config.js`](file:///Users/raunakraj/Desktop/MSME/client/vite.config.js) enforces strict vendor chunking:
```javascript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom'],
        'vendor-recharts': ['recharts'],
        'vendor-icons': ['lucide-react'],
      },
    },
  },
}
```
* **Performance Result:** Main bundle reduced from >650 kB to **266 kB** (gzip: 81 kB), completely eliminating bundle warnings.

---

## 3. Backend Technology Stack (`server/`)

| Layer | Package / Technology | Version | Purpose & Architectural Rationale |
| :--- | :--- | :--- | :--- |
| **Runtime** | **Node.js LTS** | `v20.x` / `v22.x` | Modern ECMAScript Modules (`type: "module"`), native `fetch`, native `node:test` compatibility. |
| **HTTP Framework** | **Express** | `^4.21.2` | Robust, lightweight REST API routing, streaming endpoints, and static asset delivery in production. |
| **Object Modeling** | **Mongoose** | `^8.19.1` | Schema enforcement, strict type validation, and query acceleration. |
| **Embedded Database** | **mongodb-memory-server** | `^11.3.0` | Zero-configuration local database. If external MongoDB is not detected, spins up in-memory MongoDB automatically for zero-friction evaluations. |
| **Data Validation** | **Zod** | `^4.6.7` | Strict runtime boundary validation for all API inputs, amounts, dates, and AI tool calls. |
| **CSV Ingestion** | **PapaParse** | `^5.7.0` | Memory-efficient streaming CSV parser with header mapping and dialect auto-detection. |
| **Excel Ingestion** | **read-excel-file** | `^9.3.12` | Ingests native Tally exports (`.xlsx`) without relying on vulnerable legacy dependencies. |
| **File Uploads** | **Multer** | `^2.5.0` | Multipart form-data parser with 2MB file size limits and memory-buffer storage. |
| **Security & CORS** | **CORS & Native Headers** | `^2.8.5` | Origin validation (`CLIENT_ORIGIN`), Content-Type enforcement, and formula-injection escaping. |

---

## 4. AI Copilot & Agentic Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **LLM Inference** | **Google Gemini 1.5 Flash** | Primary multimodal intelligence for bilingual understanding and multi-turn tool calling. |
| **SDK** | **`@google/genai`** | Official Google GenAI SDK for structured function declarations. |
| **Tool Calling Pattern** | **ReAct / Model Context Protocol** | Maps conversational user requests to pure deterministic tools (`get_runway`, `get_43bh_deadlines`, `simulate_order`). |
| **Fallback Engine** | **Deterministic AST Matcher** | Seamless local execution engine used when no API key is supplied or when upstream rate limits are encountered. |
| **Formatting** | **Internationalization API (`Intl`)** | Indian numbering system formatter (`en-IN`: e.g. `₹2,50,000.00`). |

---

## 5. Database Architecture & Storage Contracts

### Storage Models (`server/src/models/`)
1. **`Workspace`**: Represents the company hub (Name, As-Of Date, Opening Cash in Paise, Minimum Safety Reserve in Paise).
2. **`CashItem`**: Master ledger entries (Receivables, Payables, Expenses, Amount in Paise, Settled Paise, Due Date, Expected Date, Constraints).
3. **`RecurringRule`**: Automated monthly obligations (Payroll, Rent, Loan EMIs, Day of Month 1–28).
4. **`RescuePlan`**: Sandboxed timing-shift proposals (Target cash balance, simulated daily curve, action statuses: `proposed`, `requested`, `agreed`).
5. **`OrderScenario`**: Hypothetical customer order stress-tests (Order value, advance amount, production costs, minimum advance solver output).
6. **`ImportBatch`**: Audit ledger tracking raw uploaded rows, column mapping decisions, and commit receipts.

---

## 6. DevOps, Containerization & Deployment

### Production Docker Architecture
* **File:** [`Dockerfile`](file:///Users/raunakraj/Desktop/MSME/Dockerfile)
* **Design:** Multi-stage Alpine container:
  * *Stage 1 (Builder):* Node 20 Alpine compiles React/Vite assets into `dist/`.
  * *Stage 2 (Runner):* Installs production Node dependencies (`--omit=dev`), bundles Express API, and serves built static assets directly under port `5001`.
* **Health Check Probe:** Automated `wget` probe against `http://localhost:5001/api/health` every 30 seconds.

### Multi-Container Orchestration
* **File:** [`docker-compose.yml`](file:///Users/raunakraj/Desktop/MSME/docker-compose.yml)
* **Services:**
  * `mongodb`: Official `mongo:7-jammy` with persistent named volume `mongo-data`.
  * `hisaab-app`: High-performance container connecting to MongoDB via internal bridge network.

---

## 7. Testing & Quality Assurance Suite

* **Test Framework:** **Vitest 4.1**
* **Environment:** `node` for mathematical engine & persistence tests; `jsdom` for UI integration tests.
* **Test Coverage:** **80 passed tests across 14 test files**:
  * Unit tests for pure forecast engine (`tests/finance.test.js`).
  * Safety invariant tests preventing mutation of underlying records (`tests/rescue.safety.test.mjs`, `tests/orders.safety.test.mjs`).
  * Section 43B(h) and order feasibility persistence tests (`tests/orders.persistence.test.mjs`).
  * AI Copilot bilingual tool-calling tests (`tests/copilot.test.js`).
  * Complete full-flow seeded UI integration tests (`tests/dashboard.ui.test.jsx`, `tests/orders.ui.test.jsx`).

