# Fin-Copilot (Kavach) - 100% Zero-Cost Production Deployment Guide
> **Total Monthly Cost: ₹0 / $0.00 Forever**  
> **No credit card required** for any of these platforms.

This guide walks you through deploying Fin-Copilot into live production using the industry's most generous permanent free tiers.

---

## The Zero-Cost Tech Stack Breakdown

| Component | Platform | Plan | Monthly Cost | Limitations |
|---|---|---|---|---|
| **Fullstack Hosting** | **Vercel** | Hobby Tier | **₹0.00** | Unlimited serverless deployments, 100GB bandwidth/mo, automatic SSL |
| **Alternative Hosting** | **Render.com** | Free Web Service | **₹0.00** | 512MB RAM, free SSL, spins down on idle |
| **Database** | **MongoDB Atlas** | M0 Sandbox | **₹0.00** | 512MB storage, automated TLS, 3-node replica set |
| **Financial AI RAG** | **Google AI Studio** | Gemini 2.0 Flash | **₹0.00** | 15 requests/min, 1,500 requests/day free |
| **Keep-Alive Pinger** | **Cron-Job.org** | Free Forever | **₹0.00** | Pings `/api/healthz` every 10 mins so app never sleeps |

---

## Step 1: Set Up Free MongoDB Atlas (3 Minutes)

1. Go to [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) and sign up with your Google account (no credit card required).
2. Click **Create Deployment** → Select **M0 (Shared)**:
   - Provider: AWS or Google Cloud.
   - Region: Select **Mumbai (`ap-south-1`)** for lowest latency in India.
   - Name: `Cluster0`.
   - Tier: Free ($0/mo).
3. **Database Access (User Credentials)**:
   - Create a username (e.g. `fincopilot_user`) and a secure password. *Save this password.*
4. **Network Access (IP Whitelist)**:
   - Go to **Network Access** → Click **Add IP Address**.
   - Select **Allow Access From Anywhere (`0.0.0.0/0`)** so Vercel or Render serverless workers can connect securely.
5. **Get Your Connection String**:
   - Click **Connect** → **Drivers** (Node.js).
   - Copy the SRV string. It looks like:
     ```
     mongodb+srv://fincopilot_user:<password>@cluster0.abcde.mongodb.net/fin_copilot?retryWrites=true&w=majority
     ```
   - Replace `<password>` with your actual password.

---

## Step 2: Get Free Google Gemini API Key (1 Minute)

1. Go to [aistudio.google.com](https://aistudio.google.com/).
2. Sign in with any Google account.
3. Click **Get API key** → **Create API key in new project**.
4. Copy the generated key. (Free tier permits 15 RPM and 1,500 calls/day on `gemini-2.0-flash`).

---

## Step 3: Deploy to Vercel (Recommended - Instant & Fast)

Fin-Copilot already includes `vercel.json` and a serverless gateway (`api/index.js`).

### Method A: One-Click Web Deployment (Easiest)
1. Go to [vercel.com](https://vercel.com/) and sign up with your GitHub account.
2. Click **Add New...** → **Project**.
3. Import your `Fin-Copilot` repository (`raunakraj-01/Fin-Copilot`).
4. In the configuration screen:
   - **Framework Preset:** Other (or Vite).
   - **Root Directory:** `./` (Leave as root).
   - **Build Command:** `npm --prefix client run build` (Pre-configured in `vercel.json`).
   - **Output Directory:** `client/dist`.
5. Under **Environment Variables**, add the following 4 keys:
   - `MONGODB_URI`: *Your MongoDB connection string from Step 1.*
   - `SESSION_SECRET`: *Any random 32-character string (e.g., `fincopilot_secret_key_prod_2026_safe`).*
   - `GEMINI_API_KEY`: *Your Google AI Studio key from Step 2.*
   - `GEMINI_MODEL`: `gemini-2.0-flash`
6. Click **Deploy**!
7. Within 60 seconds, your application will be live at:
   `https://fin-copilot-XXXXX.vercel.app`

---

## Step 4: Alternative Zero-Cost Option: Render.com

If you prefer a persistent Node.js server container:

1. Sign up for free at [render.com](https://render.com/).
2. Click **New +** → **Web Service**.
3. Connect your GitHub repository (`Fin-Copilot`).
4. Set the following settings:
   - **Name:** `fin-copilot`
   - **Region:** Singapore or Frankfurt (fastest free tiers).
   - **Runtime:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `node server/src/index.js`
   - **Instance Type:** `Free` (512 MB RAM, 0.1 CPU).
5. Under **Environment Variables**, add:
   - `NODE_ENV`: `production`
   - `PORT`: `5000`
   - `MONGODB_URI`: *Your MongoDB connection string from Step 1.*
   - `SESSION_SECRET`: *Your random 32-character string.*
   - `GEMINI_API_KEY`: *Your Google AI key.*
   - `GEMINI_MODEL`: `gemini-2.0-flash`
6. Click **Create Web Service**. Your app is live with a free `onrender.com` URL!

---

## Step 5: Prevent Free Instances from Sleeping (Optional)

On Render's free tier, servers sleep after 15 minutes of inactivity. You can keep it awake 24/7 for free:
1. Go to [cron-job.org](https://cron-job.org/) (100% free).
2. Create a free account.
3. Add a new cron job:
   - **URL:** `https://your-app.onrender.com/api/healthz`
   - **Schedule:** Every 10 minutes.
4. Now your instance stays warm and responds instantly 24/7 at ₹0 cost!

---

## Production Security Check on Free Tier

Even on the zero-cost tier, Fin-Copilot maintains enterprise security:
- **HTTPS & SSL:** Handled automatically by Vercel/Render with free Cloudflare/Let's Encrypt certificates.
- **Database Encryption:** Enforced via MongoDB Atlas TLS/SSL connection string (`mongodb+srv://`).
- **CSRF & Session Security:** Protected via HTTP-only secure cookie flags and HMAC-SHA256 tokens.
- **Tenant Isolation:** Scoped database queries prevent any cross-company data leakage.
