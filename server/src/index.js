import 'dotenv/config';
import app from './app.js';
import { connectDb } from './config/db.js';
import { ensureLocalOllama } from './services/ai/startOllama.js';
import { startFollowupWorker } from './services/finance/followups.js';
import { startMorningBriefScheduler } from './services/automation/morningBriefScheduler.js';
import { startTelegramCopilot } from './services/ai/telegramCopilot.js';
import { startPaymentDelayUpdater } from './services/finance/paymentDelayUpdater.js';

const port = Number(process.env.PORT || 5000);
app.locals.localSyntheticDev = process.env.LOCAL_SYNTHETIC_DEV === '1'
  && /^mongodb:\/\/(?:127\.0\.0\.1|localhost):/.test(process.env.MONGODB_URI || '');

let server;

try {
  await ensureLocalOllama();
  await connectDb(process.env.MONGODB_URI);
  startFollowupWorker();
  startMorningBriefScheduler();
  startPaymentDelayUpdater();
  startTelegramCopilot();
  server = app.listen(port, () => {
    console.log(`[Fin-Copilot Startup] Production API ready at http://localhost:${port}/api`);
    console.log(`[Fin-Copilot Startup] Healthcheck: http://localhost:${port}/api/healthz | Readiness: http://localhost:${port}/api/readyz`);
  });
} catch (error) {
  console.error('[Fin-Copilot Startup] Fatal initialization error:', error);
  process.exitCode = 1;
}

// Enterprise SRE: Graceful shutdown handling for Docker / Kubernetes / ECS
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Fin-Copilot Startup] Received ${signal}. Initiating zero-downtime graceful shutdown...`);

  if (!server) {
    process.exit(0);
  }

  server.close(async () => {
    console.log('[Fin-Copilot Startup] HTTP server stopped accepting connections.');
    try {
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.connection.close(false);
        console.log('[Fin-Copilot Startup] MongoDB connection pool drained and closed.');
      }
      process.exit(0);
    } catch (err) {
      console.error('[Fin-Copilot Startup] Error during connection teardown:', err);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error('[Fin-Copilot Startup] Graceful shutdown timeout (10s) reached. Forcing process exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
