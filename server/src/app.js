import cors from 'cors';
import express from 'express';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// These mounts are replaced by Person 2's default-exported routers during integration.
app.use('/api/workspaces/:workspaceId/rescue', (_req, res) =>
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Rescue Planner is being built' } }));
app.use('/api/workspaces/:workspaceId/orders', (_req, res) =>
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Order Analyzer is being built' } }));

app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
});

export default app;
