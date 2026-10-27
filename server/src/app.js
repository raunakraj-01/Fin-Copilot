import cors from 'cors';
import express from 'express';
import multer from 'multer';
import workspaces from './routes/workspaces.js';
import imports from './routes/imports.js';
import items from './routes/items.js';
import forecast from './routes/forecast.js';
import { errorResponse } from './utils/http.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/workspaces', workspaces);
app.use('/api/workspaces/:workspaceId/imports', imports);
app.use('/api/workspaces/:workspaceId', items);
app.use('/api/workspaces/:workspaceId/forecast', forecast);

// These mounts are replaced by Person 2's default-exported routers during integration.
app.use('/api/workspaces/:workspaceId/rescue', (_req, res) =>
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Rescue Planner is being built' } }));
app.use('/api/workspaces/:workspaceId/orders', (_req, res) =>
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Order Analyzer is being built' } }));

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
