import cors from 'cors';
import auth from './routes/auth.js';
import { requireBusiness } from './middleware/auth.js';
import { rateLimitPublic } from './middleware/rateLimit.js';
import { getRateLimitConfig } from './config/rateLimits.js';
import { clientOrigin, isAllowedOrigin } from './services/auth.js';
import express from 'express';
import multer from 'multer';
import workspaces, { demoWorkspaceRoute } from './routes/workspaces.js';
import imports from './routes/imports.js';
import bank from './routes/bank.js';
import items from './routes/items.js';
import promises from './routes/promises.js';
import spending from './routes/spending.js';
import forecast from './routes/forecast.js';
import rescue from './routes/rescue.js';
import orders from './routes/orders.js';
import shock from './routes/shock.js';
import copilot from './routes/copilot.js';
import sync from './routes/sync.js';
import reliabilityRoutes from './routes/reliability.js';
import offers from './routes/offers.js';
import followups, { automationRouter } from './routes/followups.js';
import automation from './routes/automation.js';
import razorpayWebhook from './routes/razorpayWebhook.js';
import telegram from './routes/telegram.js';
import telegramWebhook from './routes/telegramWebhook.js';
import trust from './routes/trust.js';
import inventory from './routes/inventory.js';
import captures, { automationRouter as captureAutomation } from './routes/captures.js';
import procurement from './routes/procurement.js';
import fulfillment from './routes/fulfillment.js';
import { auditBusinessRequest } from './services/audit.js';
import { errorResponse } from './utils/http.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const app = express();
if (!process.env.VITEST) getRateLimitConfig();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-DNS-Prefetch-Control', 'off');
  res.set('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), usb=()');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use((req, res, next) => cors({
  origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin, req.get('Host'))),
  credentials: true,
})(req, res, next));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); next(); });
app.use('/api/webhooks/razorpay', rateLimitPublic('webhook'), express.raw({ type: 'application/json', limit: '1mb' }), razorpayWebhook);
app.use('/api/webhooks/telegram', rateLimitPublic('webhook'), express.json({ limit: '256kb' }), telegramWebhook);
app.use(express.json({ limit: '1mb' }));

const publicLimiter = rateLimitPublic('public');
app.get('/api/health', publicLimiter, (_req, res) => res.json(app.locals.demoMode === true ? { ok: true, demoMode: true }
  : app.locals.localSyntheticDev === true ? { ok: true, localSyntheticDev: true } : { ok: true }));

// SRE Cloud Probes: Liveness & Readiness for AWS ECS / GCP Cloud Run / Kubernetes
app.get('/api/healthz', publicLimiter, (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/readyz', publicLimiter, async (_req, res) => {
  try {
    const mongoose = (await import('mongoose')).default;
    const dbConnected = mongoose.connection?.readyState === 1 || app.locals.demoMode === true || app.locals.localSyntheticDev === true;
    if (!dbConnected) {
      return res.status(503).json({ status: 'not_ready', error: 'Database connection not ready' });
    }
    res.status(200).json({
      status: 'ready',
      uptimeSec: Math.round(process.uptime()),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      environment: process.env.NODE_ENV || 'development',
      demoMode: !!app.locals.demoMode,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ReadinessCheck] Error checking readiness:', err);
    res.status(503).json({ status: 'error', error: 'Service not ready' });
  }
});
app.use('/api/auth', auth);
app.post('/api/workspaces/demo', ...demoWorkspaceRoute);
app.use('/api/workspaces/:workspaceId', requireBusiness, auditBusinessRequest);
app.use('/api/workspaces', workspaces);
app.use('/api/workspaces/:workspaceId/imports', imports);
app.use('/api/workspaces/:workspaceId/bank', bank);
app.use('/api/workspaces/:workspaceId', items);
app.use('/api/workspaces/:workspaceId', promises);
app.use('/api/workspaces/:workspaceId/forecast', forecast);
app.use('/api/workspaces/:workspaceId/spending-check', spending);

app.use('/api/workspaces/:workspaceId/rescue', rescue);
app.use('/api/workspaces/:workspaceId/orders', orders);
app.use('/api/workspaces/:workspaceId/shock', shock);
app.use('/api/workspaces/:workspaceId/copilot', copilot);
app.use('/api/workspaces/:workspaceId/sync', sync);
app.use('/api/workspaces/:workspaceId/reliability', reliabilityRoutes);
app.use('/api/workspaces/:workspaceId/offers', offers);
app.use('/api/workspaces/:workspaceId/followups', followups);
app.use('/api/workspaces/:workspaceId/automation', automation);
app.use('/api/workspaces/:workspaceId/telegram', telegram);
app.use('/api/workspaces/:workspaceId/trust', trust);
app.use('/api/workspaces/:workspaceId/inventory', inventory);
app.use('/api/workspaces/:workspaceId/captures', captures);
app.use('/api/workspaces/:workspaceId/procurement', procurement);
app.use('/api/workspaces/:workspaceId/fulfillment', fulfillment);
app.use('/api/followup-automation', automationRouter);
app.use('/api/capture-automation', captureAutomation);

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (process.env.NODE_ENV === 'production' || existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, publicLimiter, (_req, res, next) => res.sendFile(path.join(dist, 'index.html'), err => { if (err) next(err); }));
}

app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'Uploaded file exceeds the maximum allowed size' } });
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid upload' } });
  }
  next(err);
});
app.use(errorResponse);

export default app;
