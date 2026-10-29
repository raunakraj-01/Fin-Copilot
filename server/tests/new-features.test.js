import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import { quoteDiscount } from '../src/services/finance/discount.js';
import { reliability } from '../src/services/finance/reliability.js';
import { createHmac } from 'node:crypto';

let mongo, id;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  id = String((await Workspace.create({ name: 'Feature test', asOfDate: '2026-11-01', openingCashPaise: 100000 }))._id);
  vi.stubEnv('TALLY_SYNC_TOKEN', 'secret'); vi.stubEnv('TALLY_SYNC_WORKSPACE_ID', id);
  vi.stubEnv('FEATURE_ADMIN_TOKEN', 'owner-secret');
}, 600000);
afterAll(async () => { vi.unstubAllEnvs(); await mongoose.disconnect(); await mongo?.stop(); });

it('applies a Tally batch once and updates a changed source without duplicates', async () => {
  const base = `/api/workspaces/${id}/sync/batches`;
  const batch = { companyId: 'company-a', batchId: crypto.randomUUID(), rows: [{ sourceId: 'voucher-1', version: '1', item: {
    category: 'receivable', counterparty: 'Buyer', sourceSystem: 'tally_export', amountPaise: 10000,
    settledPaise: 0, dueDate: '2026-11-10', expectedDate: '2026-11-10',
  } }] };
  await request(app).post(base).set('Authorization', 'Bearer secret').send(batch).expect(200);
  const repeated = await request(app).post(base).set('Authorization', 'Bearer secret').send(batch).expect(200);
  expect(repeated.body.alreadyApplied).toBe(true);
  await request(app).post(base).set('Authorization', 'Bearer secret').send({ ...batch, batchId: crypto.randomUUID(), rows: [{ ...batch.rows[0], version: '2', item: { ...batch.rows[0].item, amountPaise: 12000 } }] }).expect(200);
  const rows = await CashItem.find({ workspaceId: id });
  expect(rows).toHaveLength(1);
  expect(rows[0].amountPaise).toBe(12000);
});

it('suppresses buyer scores below five independent suppliers', () => {
  const observation = { buyerHash: 'buyer', invoiceDate: '2026-01-01', dueDate: '2026-02-15', clearedDate: '2026-03-10' };
  expect(reliability([1, 2, 3, 4].map(n => ({ ...observation, supplierHash: String(n) })))).toBeNull();
  const result = reliability([1, 2, 3, 4, 5].map(n => ({ ...observation, supplierHash: String(n) })));
  expect(result.supplierCount).toBe(5);
  expect(result.latenessDays).toBe(23);
});

it('requires owner consent and a verified source token for observations', async () => {
  vi.stubEnv('TELEMETRY_HMAC_KEY', 'test-hmac-secret');
  vi.stubEnv('OBSERVATION_TOKEN', 'source-secret');
  const consent = `/api/workspaces/${id}/reliability/consent`;
  await request(app).patch(consent).send({ share: true }).expect(401);
  await request(app).patch(consent).set('Authorization', 'Bearer owner-secret').send({ share: true }).expect(200);
  const observation = { buyerGstin: '22AAAAA0000A1Z5', sourceId: 'payment-1', invoiceDate: '2026-01-01',
    dueDate: '2026-02-15', clearedDate: '2026-03-10', amountPaise: 10000, source: 'bank_verified' };
  const endpoint = `/api/workspaces/${id}/reliability/observations`;
  await request(app).post(endpoint).send(observation).expect(401);
  await request(app).post(endpoint).set('Authorization', 'Bearer source-secret').send(observation).expect(202);
  await request(app).patch(consent).set('Authorization', 'Bearer owner-secret').send({ share: false }).expect(200);
});

it('uses exact paise discount arithmetic and protects previews', async () => {
  expect(quoteDiscount(40000000, 200)).toEqual({ outstandingPaise: 40000000, discountBps: 200, discountPaise: 800000, buyerPaysPaise: 39200000 });
  const item = await CashItem.create({ workspaceId: id, category: 'receivable', counterparty: 'Rajesh', sourceSystem: 'manual', amountPaise: 40000000, dueDate: '2026-11-26', expectedDate: '2026-11-26' });
  const path = `/api/workspaces/${id}/offers/preview`;
  const payload = { cashItemId: String(item._id), discountBps: 200, settleBy: '2026-11-04', phone: '919999999999' };
  await request(app).post(path).send(payload).expect(401);
  const result = await request(app).post(path).set('Authorization', 'Bearer owner-secret').send(payload).expect(200);
  expect(result.body.buyerPaysPaise).toBe(39200000);
  expect(result.body.whatsappUrl).toMatch(/^https:\/\/wa.me\//);
  expect((await CashItem.findById(item._id)).settledPaise).toBe(0);
});

it('previews a capped early collection in demo mode without changing the invoice', async () => {
  const item = await CashItem.create({ workspaceId: id, category: 'receivable', counterparty: 'Demo buyer', sourceSystem: 'manual',
    amountPaise: 40000000, dueDate: '2026-11-26', expectedDate: '2026-11-26',
    constraints: { earliestCollectionDate: '2026-11-04', maxEarlyCollectionPaise: 20000000, estimatedActionCostPaise: 300000 } });
  await CashItem.create({ workspaceId: id, category: 'payable', counterparty: 'Demo supplier', sourceSystem: 'manual',
    amountPaise: 30000000, dueDate: '2026-11-06', expectedDate: '2026-11-06' });
  app.locals.demoMode = true;
  try {
    const result = await request(app).post(`/api/workspaces/${id}/offers/preview`).send({ cashItemId: String(item._id),
      amountPaise: 20000000, discountBps: 200, settleBy: '2026-11-04', phone: '919999999999' }).expect(200);
    expect(result.body.buyerPaysPaise).toBe(19600000);
    expect(result.body.remainingOutstandingPaise).toBe(20000000);
    expect(result.body.forecast.simulatedWorstCashPaise).toBeGreaterThan(result.body.forecast.baselineWorstCashPaise);
    expect((await CashItem.findById(item._id)).amountPaise).toBe(40000000);
  } finally { app.locals.demoMode = false; }
});

it('accepts an international + number in local synthetic dev only', async () => {
  const item = await CashItem.create({ workspaceId: id, category: 'receivable', counterparty: 'Phone test', sourceSystem: 'manual',
    amountPaise: 10000, dueDate: '2026-11-20', expectedDate: '2026-11-20' });
  const endpoint = `/api/workspaces/${id}/offers/preview`;
  const body = { cashItemId: String(item._id), discountBps: 200, settleBy: '2026-11-04', phone: '+919999999999' };
  await request(app).post(endpoint).send(body).expect(401);
  app.locals.localSyntheticDev = true;
  try {
    const result = await request(app).post(endpoint).send(body).expect(200);
    expect(result.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919999999999\?/);
    expect(result.body.desktopUrl).toMatch(/^whatsapp:\/\/send\?phone=919999999999&text=/);
    expect(result.body.recipientPhone).toBe('919999999999');
  } finally { app.locals.localSyntheticDev = false; }
});

it('creates a Razorpay link and settles a verified paid webhook exactly once', async () => {
  vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_fake');
  vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-api-secret');
  vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'test-webhook-secret');
  const item = await CashItem.create({ workspaceId: id, category: 'receivable', counterparty: 'Payment buyer', sourceSystem: 'manual',
    amountPaise: 10000, dueDate: '2026-11-20', expectedDate: '2026-11-20' });
  vi.stubGlobal('fetch', vi.fn(async (url, _options) => ({ ok: true, json: async () => url.endsWith('/plink_Test123')
    ? { id: 'plink_Test123', reference_id: JSON.parse(fetch.mock.calls[0][1].body).reference_id, status: 'paid', currency: 'INR', amount: 9800, amount_paid: 9800 }
    : { id: 'plink_Test123', short_url: 'https://rzp.io/i/test' } })));
  const created = await request(app).post(`/api/workspaces/${id}/offers/payment-link`).set('Authorization', 'Bearer owner-secret')
    .send({ cashItemId: String(item._id), amountPaise: 10000, discountBps: 200, settleBy: '2026-11-04', phone: '+919999999999' }).expect(201);
  expect(created.body.message).toContain('https://rzp.io/i/test');
  const referenceId = JSON.parse(fetch.mock.calls[0][1].body).reference_id;
  const event = { event: 'payment_link.paid', created_at: Date.parse('2026-11-04T12:00:00Z') / 1000,
    payload: { payment_link: { entity: { id: 'plink_Test123', reference_id: referenceId, status: 'paid', currency: 'INR', amount: 9800, amount_paid: 9800 } },
      payment: { entity: { id: 'pay_Test123', status: 'captured', currency: 'INR', amount: 9800 } } } };
  const body = JSON.stringify(event);
  const signature = createHmac('sha256', 'test-webhook-secret').update(body).digest('hex');
  await request(app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', '0'.repeat(64)).send(body).expect(401);
  for (let attempt = 0; attempt < 2; attempt++) await request(app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(body).expect(200);
  const settled = await CashItem.findById(item._id);
  expect(settled.settledPaise).toBe(10000);
  expect(settled.status).toBe('paid');
  expect(settled.gatewayReceipts).toHaveLength(1);
  const status = await request(app).get(`/api/workspaces/${id}/offers/payment-link/${created.body.id}`).set('Authorization', 'Bearer owner-secret').expect(200);
  expect(status.body.status).toBe('paid');
  vi.unstubAllGlobals();
});
