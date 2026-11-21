# 🚀 Deploying Fin-Copilot to Vercel

This guide documents how to deploy the Fin-Copilot application (React 19 Vite frontend + Express.js backend API) to [Vercel](https://vercel.com).

---

## 1. Architecture on Vercel

```
                                  Client Browser
                                        │
                                        ▼
                             Vercel Edge Network
                         ┌──────────────┴──────────────┐
                         ▼                             ▼
                 Static Assets (/...)          Serverless Function (/api/...)
                 Vite Bundle (client/dist)     api/index.js (Express Handler)
                         │                             │
                         ▼                             ▼
                 Instant CDN Delivery          MongoDB Atlas Database
```

- **Frontend:** Built with Vite into `client/dist`. Vercel automatically serves all static assets (HTML, CSS, JS, images) via its global edge CDN.
- **Backend:** Requests matching `/api/(.*)` are routed to the serverless function entrypoint at [`api/index.js`](file:///Users/raunakraj/Desktop/Copy/Fin-Copilot/api/index.js), which invokes the Express application with cached MongoDB connection pooling.
- **Client Routing:** All non-API routes are rewritten to `/index.html` to support React's client-side routing (`/setup-import`, `/cash-outlook`, `/cash-shock-lab`, `/rescue-planner`, `/new-order-analyzer`, `/cash-copilot`, `/operations`).

---

## 2. Configuration Files

### `vercel.json`
Located at the root of the project:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm --prefix client run build",
  "outputDirectory": "client/dist",
  "installCommand": "npm --prefix client install && npm --prefix server install",
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/index.js"
    },
    {
      "source": "/((?!api/).*)",
      "destination": "/index.html"
    }
  ]
}
```

### `api/index.js`
The serverless adapter that connects Mongoose to MongoDB Atlas and mounts the Express app:
```javascript
import app from '../server/src/app.js';
import { connectDb } from '../server/src/config/db.js';

export default async function handler(req, res) {
  if (process.env.MONGODB_URI) {
    try {
      await connectDb(process.env.MONGODB_URI);
    } catch (err) {
      console.error('Serverless database connection error:', err);
      return res.status(500).json({
        error: { code: 'DATABASE_ERROR', message: 'Database connection failed' },
      });
    }
  }
  return app(req, res);
}
```

---

## 3. Required Environment Variables

Configure these in your Vercel Project Dashboard under **Settings $\rightarrow$ Environment Variables**:

| Variable | Required | Description | Example / Recommended Value |
|---|:---:|---|---|
| `MONGODB_URI` | **Yes** | MongoDB Atlas connection string | `mongodb+srv://<user>:<password>@cluster0.abcde.mongodb.net/cashflow_copilot?retryWrites=true&w=majority` |
| `NODE_ENV` | **Yes** | Node environment | `production` |
| `CLIENT_ORIGIN` | Optional | Custom production domain (if using a custom domain) | `https://fincopilot.yourdomain.com` *(defaults to current Vercel domain)* |
| `TELEMETRY_HMAC_KEY` | Optional | 32-byte hex secret for telemetry | Any random 64-character hex string |
| `OPENAI_API_KEY` | Optional | OpenAI API key for AI-selected explanation grounding | `sk-...` |
| `OPENAI_MODEL` | Optional | Model ID for structured outputs | `gpt-4o-mini` |
| `GEMINI_API_KEY` | Optional | Google Gemini API key for Copilot NLP | `AIzaSy...` |
| `GEMINI_MODEL` | Optional | Gemini model | `gemini-1.5-flash` |
| `RAZORPAY_KEY_ID` | Optional | Razorpay Key ID (test mode) | `rzp_test_...` |
| `RAZORPAY_KEY_SECRET` | Optional | Razorpay Key Secret | `...` |
| `RAZORPAY_WEBHOOK_SECRET` | Optional | Razorpay Webhook Secret | `...` |

> [!IMPORTANT]
> **MongoDB Atlas Network Access:**
> In your MongoDB Atlas console, ensure that **Network Access** allows access from `0.0.0.0/0` (Allow Access from Anywhere) or uses Atlas VPC peering, as Vercel serverless function IP addresses are dynamic.

---

## 4. Deployment Steps

### Option A: Via Vercel Web Dashboard (Recommended)

1. Push your repository to GitHub, GitLab, or Bitbucket.
2. Go to [vercel.com/new](https://vercel.com/new).
3. Import your `Fin-Copilot` repository.
4. Framework Preset: select **Other** (the `vercel.json` will supply all build and output settings automatically).
5. Open **Environment Variables** and add `MONGODB_URI` and `NODE_ENV=production`.
6. Click **Deploy**.

### Option B: Via Vercel CLI

1. Install the Vercel CLI:
   ```bash
   npm install -g vercel
   ```
2. Run deployment from the repository root:
   ```bash
   vercel
   ```
3. Set your environment variables:
   ```bash
   vercel env add MONGODB_URI production
   vercel env add NODE_ENV production
   ```
4. Deploy to production:
   ```bash
   vercel --prod
   ```

---

## 5. Verification After Deployment

Once deployed:
1. Open `https://<your-project>.vercel.app/api/health` in your browser. It should respond with:
   ```json
   { "ok": true }
   ```
2. Navigate to `https://<your-project>.vercel.app/` — you should see the landing page and authentication screen.
3. Register an account or sign in to verify that `__Host-cashflow_session` cookies are set over HTTPS and that workspace creation succeeds.
