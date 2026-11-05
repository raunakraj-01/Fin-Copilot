import cors from 'cors';
import express from 'express';
import multer from 'multer';
import workspaces from './routes/workspaces.js';
import imports from './routes/imports.js';
import items from './routes/items.js';
import forecast from './routes/forecast.js';
import rescue from './routes/rescue.js';
import orders from './routes/orders.js';
import shock from './routes/shock.js';
import copilot from './routes/copilot.js';
import sync from './routes/sync.js';
import reliabilityRoutes from './routes/reliability.js';
import offers from './routes/offers.js';
import followups, { automationRouter } from './routes/followups.js';
import razorpayWebhook from './routes/razorpayWebhook.js';
import { errorResponse } from './utils/http.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), razorpayWebhook);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json(app.locals.demoMode === true ? { ok: true, demoMode: true }
  : app.locals.localSyntheticDev === true ? { ok: true, localSyntheticDev: true } : { ok: true }));
app.use('/api/workspaces', workspaces);
app.use('/api/workspaces/:workspaceId/imports', imports);
app.use('/api/workspaces/:workspaceId', items);
app.use('/api/workspaces/:workspaceId/forecast', forecast);

app.use('/api/workspaces/:workspaceId/rescue', rescue);
app.use('/api/workspaces/:workspaceId/orders', orders);
app.use('/api/workspaces/:workspaceId/shock', shock);
app.use('/api/workspaces/:workspaceId/copilot', copilot);
app.use('/api/workspaces/:workspaceId/sync', sync);
app.use('/api/workspaces/:workspaceId/reliability', reliabilityRoutes);
app.use('/api/workspaces/:workspaceId/offers', offers);
app.use('/api/workspaces/:workspaceId/followups', followups);
app.use('/api/followup-automation', automationRouter);

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'Maximum file size is 2 MB' } });
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid upload' } });
  }
  next(err);
});
app.use(errorResponse);

export default app;
