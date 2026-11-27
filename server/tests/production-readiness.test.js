import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import rawRequest from 'supertest';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { isAllowedOrigin } from '../src/services/auth.js';
import { dispatchFollowupWebhook } from '../src/services/finance/followups.js';
import { startTelegramCopilot } from '../src/services/ai/telegramCopilot.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import CollectionFollowUp from '../src/models/CollectionFollowUp.js';

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 600_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it('rejects arbitrary *.vercel.app origins while allowing explicit ALLOWED_ORIGINS', () => {
  expect(isAllowedOrigin('https://attacker-preview.vercel.app', 'app.example.com')).toBe(false);
  vi.stubEnv('ALLOWED_ORIGINS', 'https://app.cashflowcopilot.in, https://preview.cashflowcopilot.in');
  expect(isAllowedOrigin('https://app.cashflowcopilot.in', 'api.cashflowcopilot.in')).toBe(true);
  expect(isAllowedOrigin('https://attacker-preview.vercel.app', 'api.cashflowcopilot.in')).toBe(false);
  vi.stubEnv('NODE_ENV', 'production');
  expect(isAllowedOrigin('http://localhost:5173', 'app.cashflowcopilot.in')).toBe(false);
});

it('sets Content-Security-Policy and sets HSTS in production', async () => {
  const devRes = await rawRequest(app).get('/api/healthz').expect(200);
  expect(devRes.headers['content-security-policy']).toContain("default-src 'self'");
  expect(devRes.headers['content-security-policy']).toContain("frame-ancestors 'none'");

  vi.stubEnv('NODE_ENV', 'production');
  const prodRes = await rawRequest(app).get('/api/healthz').expect(200);
  expect(prodRes.headers['strict-transport-security']).toContain('max-age=31536000');
});

it('accepts rzp_live_ Razorpay credentials in payment link creation', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_live_ExampleKey123');
  vi.stubEnv('RAZORPAY_KEY_SECRET', 'live-secret');
  vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'live-webhook-secret');

  const createdWs = await request(app).post('/api/workspaces').send({
    name: 'Live Razorpay Test',
    asOfDate: '2026-11-01',
    openingCashPaise: 500_000,
    minimumReservePaise: 0,
  }).expect(201);
  const wsId = createdWs.body.workspace.id;

  const item = await CashItem.create({
    workspaceId: wsId,
    category: 'receivable',
    counterparty: 'Live Buyer',
    sourceSystem: 'manual',
    amountPaise: 10_000,
    dueDate: '2026-11-20',
    expectedDate: '2026-11-20',
  });

  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'plink_Live123', short_url: 'https://rzp.io/i/live123' }),
  })));

  const res = await request(app)
    .post(`/api/workspaces/${wsId}/offers/payment-link`)
    .send({ cashItemId: String(item._id), amountPaise: 10_000, discountBps: 200, settleBy: '2026-11-04', phone: '+919999999999' })
    .expect(201);

  expect(res.body.paymentUrl).toBe('https://rzp.io/i/live123');
});

it('prevents cross-tenant webhook broadcast when multiple workspaces exist without a pinned workspace ID', async () => {
  vi.stubEnv('FOLLOWUP_ALLOW_SEND', '1');
  vi.stubEnv('FOLLOWUP_WEBHOOK_URL', 'https://hooks.example.com/global');
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);

  const ws1 = await Workspace.create({ name: 'Tenant One', asOfDate: '2026-11-01', openingCashPaise: 100_000 });
  const ws2 = await Workspace.create({ name: 'Tenant Two', asOfDate: '2026-11-01', openingCashPaise: 100_000 });
  const item1 = await CashItem.create({
    workspaceId: ws1._id,
    category: 'receivable',
    counterparty: 'Tenant One Buyer',
    sourceSystem: 'manual',
    amountPaise: 50_000,
    dueDate: '2026-10-15',
    expectedDate: '2026-11-10',
  });
  const rule = await CollectionFollowUp.create({
    workspaceId: ws1._id,
    cashItemId: item1._id,
    phone: '919999999999',
    mode: 'demo',
    nextRunAt: new Date(),
  });

  const sent = await dispatchFollowupWebhook(rule, { item: item1, message: 'Reminder for Tenant One' });
  expect(sent).toBe(false);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(ws2._id).toBeTruthy();
});

it('fails closed in Telegram Copilot when TELEGRAM_ALLOWED_CHAT_ID is empty', async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '123456:fake-token');
  vi.stubEnv('TELEGRAM_ALLOWED_CHAT_ID', '');
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);

  const stop = await startTelegramCopilot();
  expect(typeof stop).toBe('function');
  expect(fetchSpy).not.toHaveBeenCalled();
});
