// Development-only synthetic server. This file is never imported by the application.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createRescueRouter } from '../src/routes/rescue.js';
import { createOrdersRouter } from '../src/routes/orders.js';
import { buildForecast } from './rescueForecastStub.mjs';
import { fixtureContext, isolatedContext } from './rescueFixtureSupport.mjs';
const app = express();
app.use(express.json({ limit: '64kb' }));
const dependencies = { buildForecast, loadContext: async id => id === '000000000000000000000001' ? fixtureContext() : id === '000000000000000000000002' ? isolatedContext() : null };
app.use('/api/workspaces/:workspaceId/rescue', createRescueRouter(dependencies));
app.use('/api/workspaces/:workspaceId/orders', createOrdersRouter(dependencies));
app.use(express.static(fileURLToPath(new URL('../../preview/', import.meta.url))));
const port = Number(process.env.PERSON2_PREVIEW_PORT || 5174);
app.listen(port, '127.0.0.1', () => console.log(`Synthetic Person 2 preview: http://127.0.0.1:${port} (test forecast, no MongoDB)`));
