import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import app from '../src/app.js';
import User from '../src/models/User.js';
import AuthAttempt from '../src/models/AuthAttempt.js';
import AuthSession from '../src/models/AuthSession.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import SecurityEvent from '../src/models/SecurityEvent.js';
import { parseTallyXml } from '../src/services/imports/tallyXml.js';
import { maskPII } from '../src/services/ai/copilot.js';
import { resetRateLimiters } from '../src/middleware/rateLimit.js';

let mongo;
let seq = 0;
const password = 'Strong B2B Password 99!';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), AuthAttempt.init(), AuthSession.init(), SecurityEvent.init()]);
}, 600_000);

beforeEach(async () => {
  resetRateLimiters();
  await Promise.all([AuthAttempt.deleteMany({}), SecurityEvent.collection.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function registerUser(name = 'Security Owner') {
  const email = `sec-${++seq}@company.example`;
  const res = await request(app).post('/api/auth/register').send({ name, email, password }).expect(201);
  return {
    ...res.body,
    email,
    cookie: res.headers['set-cookie'][0].split(';')[0],
  };
}

function authed(client, method, path, body) {
  const req = request(app)[method](path).set('Cookie', client.cookie).set('X-CSRF-Token', client.csrfToken);
  return body === undefined ? req : req.send(body);
}

it('prevents signup email enumeration and records append-only SecurityEvents for auth activity', async () => {
  const owner = await registerUser();
  const dup = await request(app).post('/api/auth/register').send({ name: 'Other', email: owner.email, password }).expect(409);
  expect(dup.body.error.message).toBe('Unable to create an account with these details');

  await request(app).post('/api/auth/login').send({ email: owner.email, password: 'wrong-password' }).expect(401);
  await request(app).post('/api/auth/login').send({ email: owner.email, password }).expect(200);

  const events = await SecurityEvent.find({}).sort({ at: 1 }).lean();
  expect(events.some(e => e.action === 'auth.register' && e.outcome === 'succeeded')).toBe(true);
  expect(events.some(e => e.action === 'auth.register' && e.outcome === 'failed')).toBe(true);
  expect(events.some(e => e.action === 'auth.login' && e.outcome === 'failed')).toBe(true);
  expect(events.some(e => e.action === 'auth.login' && e.outcome === 'succeeded')).toBe(true);

  await expect(SecurityEvent.deleteMany({})).rejects.toThrow('Security events are append-only');
  await expect(SecurityEvent.updateMany({}, { $set: { outcome: 'failed' } })).rejects.toThrow('Security events are append-only');
});

it('masks PAN, Aadhaar, email, phone, account, GSTIN, and IFSC in Copilot maskPII', () => {
  const sample = 'Acct 1234567890123456 GST 22AAAAA0000A1Z5 IFSC HDFC0123456 PAN ABCDE1234F UID 1234-5678-9012 Mail cfo@acme.in Tel +91 9876543210';
  const masked = maskPII(sample);
  expect(masked).toContain('[ACCOUNT]');
  expect(masked).toContain('[GSTIN]');
  expect(masked).toContain('[IFSC]');
  expect(masked).toContain('[PAN]');
  expect(masked).toContain('[AADHAAR]');
  expect(masked).toContain('[EMAIL]');
  expect(masked).toContain('[PHONE]');
  expect(masked).not.toContain('ABCDE1234F');
  expect(masked).not.toContain('cfo@acme.in');
  expect(masked).not.toContain('9876543210');
});

it('parses malformed unclosed Tally XML blocks in linear time without regex backtracking DoS', () => {
  const adversarialXml = `<ENVELOPE>${'<VOUCHER VCHTYPE="Sales">'.repeat(25_000)}</ENVELOPE>`;
  const started = Date.now();
  const parsed = parseTallyXml(adversarialXml);
  const elapsedMs = Date.now() - started;
  expect(parsed.vouchers).toEqual([]);
  expect(elapsedMs).toBeLessThan(250);
});

it('enforces heavy-endpoint rate limits on demo workspace provisioning and copilot chat', async () => {
  const owner = await registerUser();
  for (let i = 0; i < 10; i++) {
    await authed(owner, 'post', '/api/workspaces/demo', {}).expect(i === 0 ? 201 : 200);
  }
  await authed(owner, 'post', '/api/workspaces/demo', {}).expect(429);

  const ws = (await authed(owner, 'post', '/api/workspaces', {
    name: 'Rate Chat Biz',
    asOfDate: '2026-11-01',
    openingCashPaise: 100_000,
  }).expect(201)).body.workspace;

  for (let i = 0; i < 30; i++) {
    await authed(owner, 'post', `/api/workspaces/${ws.id}/copilot/chat`, {
      message: 'When will I run out of cash?',
      sessionId: `s-${i}`,
    }).expect(200);
  }
  await authed(owner, 'post', `/api/workspaces/${ws.id}/copilot/chat`, {
    message: 'When will I run out of cash?',
    sessionId: 's-over',
  }).expect(429);
}, 30_000);

it('supports owner-confirmed workspace deletion and password-confirmed account erasure without affecting other tenants', async () => {
  const owner = await registerUser('To Erase');
  const other = await registerUser('Other Tenant');

  const ws = (await authed(owner, 'post', '/api/workspaces', {
    name: 'Erase Me Pvt Ltd',
    asOfDate: '2026-11-01',
    openingCashPaise: 500_000,
  }).expect(201)).body.workspace;

  const otherWs = (await authed(other, 'post', '/api/workspaces', {
    name: 'Keep Safe Ltd',
    asOfDate: '2026-11-01',
    openingCashPaise: 900_000,
  }).expect(201)).body.workspace;

  await CashItem.create({
    workspaceId: ws.id,
    category: 'receivable',
    counterparty: 'Gone Customer',
    sourceSystem: 'manual',
    amountPaise: 25_000,
    dueDate: '2026-11-15',
    expectedDate: '2026-11-15',
  });

  // Wrong workspace name fails
  await authed(owner, 'delete', `/api/workspaces/${ws.id}`, { workspaceName: 'Wrong Name' }).expect(400);
  // Exact workspace name deletes workspace + all its records
  await authed(owner, 'delete', `/api/workspaces/${ws.id}`, { workspaceName: 'Erase Me Pvt Ltd' }).expect(204);
  expect(await Workspace.findById(ws.id)).toBeNull();
  expect(await CashItem.countDocuments({ workspaceId: ws.id })).toBe(0);

  // Create second workspace and verify full account erasure
  const ws2 = (await authed(owner, 'post', '/api/workspaces', {
    name: 'Second Biz',
    asOfDate: '2026-11-01',
    openingCashPaise: 100_000,
  }).expect(201)).body.workspace;

  await authed(owner, 'delete', '/api/auth/account', { currentPassword: 'wrong' }).expect(401);
  await authed(owner, 'delete', '/api/auth/account', { currentPassword: password }).expect(204);

  expect(await User.findById(owner.user.id)).toBeNull();
  expect(await Workspace.findById(ws2.id)).toBeNull();
  expect(await AuthSession.countDocuments({ userId: owner.user.id })).toBe(0);
  await authed(owner, 'get', '/api/auth/me').expect(401);

  // Other tenant remains completely intact
  expect(await Workspace.findById(otherWs.id)).not.toBeNull();
  await authed(other, 'get', `/api/workspaces/${otherWs.id}`).expect(200);
});
