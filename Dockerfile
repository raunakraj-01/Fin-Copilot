# syntax=docker/dockerfile:1.4
# ==============================================================================
# Fin-Copilot (Kavach MSME Risk Radar) - Multi-Stage Production Dockerfile
# Enterprise SRE Compliant: Non-Root Execution, Signal Forwarding, Healthcheck
# ==============================================================================

# --- Stage 1: Build Frontend Assets ---
FROM node:22-alpine AS client-builder
WORKDIR /app/client

# Cache dependency layer
COPY client/package*.json ./
RUN npm ci

# Build optimized production bundle
COPY client/ ./
RUN npm run build

# --- Stage 2: Production Server Runtime ---
FROM node:22-alpine AS production
WORKDIR /app/server

# Install dumb-init for proper PID 1 signal forwarding (graceful shutdown)
RUN apk add --no-cache dumb-init wget

# Cache server dependencies (production only)
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy server application code
COPY server/src ./src
COPY server/scripts/assign-business-owner.mjs ./scripts/assign-business-owner.mjs
COPY server/scripts/check-database.mjs ./scripts/check-database.mjs
COPY fixtures /app/fixtures

# Copy built frontend assets from client-builder
COPY --from=client-builder --chown=node:node /app/client/dist /app/client/dist

# Security hardening: Ensure ownership belongs to non-root 'node' user
RUN chown -R node:node /app

# Switch to unprivileged user
USER node

# Environment defaults
ENV NODE_ENV=production \
    PORT=5000

EXPOSE 5000

# Automated Container Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5000/api/healthz || exit 1

# Launch with dumb-init wrapper to handle SIGTERM/SIGINT cleanly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/index.js"]
