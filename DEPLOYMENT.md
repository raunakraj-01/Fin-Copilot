# Fin-Copilot (Kavach MSME Risk Radar) - Enterprise Production Deployment Runbook

---

## 1. Architecture Overview

Fin-Copilot is built as an enterprise-grade 12-Factor B2B SaaS application:
- **Frontend:** React 19 SPA bundled with Vite into static optimized assets (`/app/client/dist`).
- **Backend:** Node.js 22 LTS Express server serving both the REST API and the static client bundle.
- **Database:** MongoDB 7.0 multi-tenant store with strict indexed workspace scoping.
- **Security:** Non-root execution (`USER node`), dumb-init PID 1 signal forwarding, HMAC-SHA256 CSRF protection, and CWE-1236 CSV injection sanitization.

---

## 2. Quickstart: Docker Compose (Local / Single-VM Staging)

The repository includes a production-grade multi-stage `Dockerfile` and `docker-compose.yml`.

### Prerequisites
- Docker Engine 24.0+ & Docker Compose v2.20+
- Port 5000 and 27017 available

### Single-Command Launch
```bash
# 1. Clone the repository and navigate to root
git clone https://github.com/raunakraj-01/Fin-Copilot.git
cd Fin-Copilot

# 2. Configure production environment
cp .env.production.example .env.production

# 3. Build and launch containers in detached mode
docker compose --env-file .env.production up -d --build

# 4. Verify running health checks
docker compose ps
docker compose logs -f app
```

### Checking SRE Health Probes
```bash
# Liveness probe
curl -i http://localhost:5000/api/healthz

# Readiness probe (includes heap memory, uptime, database connectivity)
curl -i http://localhost:5000/api/readyz
```

---

## 3. Production Cloud Deployment

### Option A: AWS ECS Fargate + MongoDB Atlas (Recommended)

1. **Database:** Provision a MongoDB Atlas M10+ replica set with AWS PrivateLink or IP access list.
2. **Container Registry:** Build and push the Docker image to AWS ECR:
   ```bash
   aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <aws_account_id>.dkr.ecr.ap-south-1.amazonaws.com
   docker build -t fin-copilot:latest .
   docker tag fin-copilot:latest <aws_account_id>.dkr.ecr.ap-south-1.amazonaws.com/fin-copilot:latest
   docker push <aws_account_id>.dkr.ecr.ap-south-1.amazonaws.com/fin-copilot:latest
   ```
3. **ECS Task Definition:**
   - Launch type: `FARGATE`
   - CPU: `1 vCPU` (1024), Memory: `2 GB` (2048)
   - Port mappings: `5000`
   - Healthcheck:
     - Command: `CMD-SHELL, wget -q -O /dev/null http://127.0.0.1:5000/api/healthz || exit 1`
     - Interval: 30s, Timeout: 5s, Retries: 3, Start period: 15s
   - Secrets: Inject `MONGODB_URI`, `SESSION_SECRET`, `GEMINI_API_KEY` from AWS Secrets Manager.
4. **Application Load Balancer (ALB):**
   - Target group protocol: HTTP, Port: 5000
   - Health check path: `/api/healthz`
   - HTTPS listener (Port 443) with ACM SSL Certificate.

### Option B: Google Cloud Run (Serverless Container)

```bash
# 1. Build and submit image to Google Artifact Registry
gcloud builds submit --tag gcr.io/<PROJECT_ID>/fin-copilot:latest

# 2. Deploy container with automated scaling and secret injection
gcloud run deploy fin-copilot \
  --image gcr.io/<PROJECT_ID>/fin-copilot:latest \
  --platform managed \
  --region asia-south1 \
  --allow-unauthenticated \
  --port 5000 \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars NODE_ENV=production \
  --set-secrets MONGODB_URI=FIN_COPILOT_MONGO_URI:latest,SESSION_SECRET=FIN_COPILOT_SESSION_SECRET:latest
```

---

## 4. Reverse Proxy & SSL Termination (Caddy Example)

For single-instance VM deployments (e.g. AWS EC2, DigitalOcean Droplet, Hetzner):

Create `/etc/caddy/Caddyfile`:
```caddy
app.fincopilot.in {
    encode gzip zstd
    
    # Reverse proxy to local container
    reverse_proxy 127.0.0.1:5000 {
        header_up Host {host}
        header_up X-Real-IP {remote}
        header_up X-Forwarded-For {remote}
        header_up X-Forwarded-Proto {scheme}
    }

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

---

## 5. Operational Maintenance & Disaster Recovery

### Automated Database Backup (Daily Cron)
```bash
#!/usr/bin/env bash
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/backups/mongodb"
mkdir -p "$BACKUP_DIR"

# Perform mongodump from running Docker container
docker exec fin-copilot-mongo mongodump --archive="/data/db/backup_${TIMESTAMP}.gz" --gzip
docker cp fin-copilot-mongo:/data/db/backup_${TIMESTAMP}.gz "$BACKUP_DIR/"
docker exec fin-copilot-mongo rm "/data/db/backup_${TIMESTAMP}.gz"

# Retain only last 14 days of backups
find "$BACKUP_DIR" -type f -name "*.gz" -mtime +14 -delete
```

### Database Restore Procedure
```bash
docker cp /backups/mongodb/backup_YYYYMMDD_HHMMSS.gz fin-copilot-mongo:/tmp/restore.gz
docker exec -i fin-copilot-mongo mongorestore --archive=/tmp/restore.gz --gzip --drop
docker exec fin-copilot-mongo rm /tmp/restore.gz
```

---

## 6. SRE Invariant Checklist

Before declaring production readiness for any customer tenant:
- [x] Integer-paise arithmetic verified: No floating-point rounding errors on ledger transactions.
- [x] Multi-tenant isolation verified: Cross-tenant data access rejected with HTTP 403.
- [x] CWE-1236 sanitization active: Formulas in exports prefixed with `'` to prevent spreadsheet code execution.
- [x] Container non-root security: Executing strictly as UID `node` (1000).
- [x] Zero-downtime signal handling: `SIGTERM` and `SIGINT` drain database pools within 10 seconds.
- [x] Automated test matrix: 41 test suites and 234 automated tests passing.
