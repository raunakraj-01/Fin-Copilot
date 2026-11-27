import 'dotenv/config';
import app from './app.js';
import { connectDb } from './config/db.js';
import { ensureLocalOllama } from './services/ai/startOllama.js';
import { startFollowupWorker } from './services/finance/followups.js';
import { startMorningBriefScheduler } from './services/automation/morningBriefScheduler.js';
import { startTelegramCopilot } from './services/ai/telegramCopilot.js';
import { startPaymentDelayUpdater } from './services/finance/paymentDelayUpdater.js';

const port = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === 'production';
app.locals.localSyntheticDev = !isProduction && process.env.LOCAL_SYNTHETIC_DEV === '1'
  && /^mongodb:\/\/(?:127\.0\.0\.1|localhost):/.test(process.env.MONGODB_URI || '');

let server;

async function startServer() {
  let connected = false;

  if (process.env.MONGODB_URI) {
    try {
      console.log('Attempting connection to MongoDB...');
      await connectDb(process.env.MONGODB_URI, { serverSelectionTimeoutMS: isProduction ? 15_000 : 5000 });
      connected = true;
      console.log('✓ Connected to MongoDB');
    } catch (err) {
      if (isProduction || process.env.ALLOW_MEMORY_DB_FALLBACK !== '1') {
        throw err;
      }
      console.warn(`! Could not connect to external MongoDB: ${err.message}`);
    }
  } else if (isProduction || process.env.ALLOW_MEMORY_DB_FALLBACK !== '1') {
    throw new Error('MONGODB_URI environment variable is required');
  }

  // Embedded MongoMemoryServer fallback is strictly opt-in for local non-production dev
  if (!connected) {
    console.log('⚡ Initializing embedded in-memory MongoDB engine (non-production fallback)...');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await connectDb(uri);
    console.log('✓ Embedded MongoDB engine running');

    try {
      const { seedDemoDatabase } = await import('./seed/seedData.js');
      await seedDemoDatabase();
    } catch (seedErr) {
      console.warn('Seed notice:', seedErr.message);
    }
  }

  try {
    await ensureLocalOllama().catch(() => {});
    startFollowupWorker();
    startMorningBriefScheduler();
    startPaymentDelayUpdater();
    startTelegramCopilot();
  } catch (err) {
    console.warn('Background services notice:', err.message);
  }

  server = app.listen(port, () => {
    console.log(`====================================================`);
    console.log(`🚀 Fin-Copilot API & Dashboard running at http://localhost:${port}`);
    console.log(`⚡ Healthcheck: http://localhost:${port}/api/health | http://localhost:${port}/api/healthz`);
    console.log(`====================================================`);
  });
}

startServer().catch(error => {
  console.error('[Fin-Copilot Startup] Fatal initialization error:', error);
  process.exitCode = 1;
});

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
