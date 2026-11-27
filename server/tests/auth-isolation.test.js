// These tests intentionally use raw supertest: no regression fixture authentication.
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import User from '../src/models/User.js';
import AuthSession from '../src/models/AuthSession.js';
import AuthAttempt from '../src/models/AuthAttempt.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import BankTransaction from '../src/models/BankTransaction.js';
import ImportBatch from '../src/models/ImportBatch.js';
import OrderScenario from '../src/models/OrderScenario.js';
import RescuePlan from '../src/models/RescuePlan.js';
import CollectionFollowUp from '../src/models/CollectionFollowUp.js';
import { tokenHash } from '../src/services/auth.js';
import { resetRateLimiters } from '../src/middleware/rateLimit.js';
let mongo, sequence = 0;
const password = 'Long test password 42!';
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Promise.all([User.init(), AuthSession.init(), AuthAttempt.init()]); }, 600000);
beforeEach(async () => { await AuthAttempt.deleteMany({}); resetRateLimiters(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); app.locals.demoMode = false; app.locals.localSyntheticDev = false; });
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
async function register(name = 'Owner') {
  const email = `account-${++sequence}@example.test`;
  const response = await request(app).post('/api/auth/register').send({ name, email, password }).expect(201);
  return { ...response.body, cookie: response.headers['set-cookie'][0].split(';')[0], email, response };
}
function call(client, method, path, body) {
  const req = request(app)[method](path).set('Cookie', client.cookie).set('X-CSRF-Token', client.csrfToken);
  return body === undefined ? req : req.send(body);
}
async function business(client, name = 'Business') {
  return (await call(client, 'post', '/api/workspaces', { name, asOfDate: '2026-11-01', openingCashPaise: 20000 }).expect(201)).body.workspace;
}
async function setup() {
  const a = await register('Owner A'), b = await register('Owner B');
  const wa = await business(a, 'A private business'), wb = await business(b, 'SECRET-B business');
  const invoice = async (w, name) => CashItem.create({ workspaceId: w.id, category: 'receivable', externalId: name,
    counterparty: name, sourceSystem: 'manual', amountPaise: 10000, dueDate: '2026-11-10', expectedDate: '2026-11-10' });
  return { a, b, wa, wb, ia: await invoice(wa, 'A invoice'), ib: await invoice(wb, 'SECRET-B invoice') };
}
async function invite(owner, workspace, accountant) {
  const response = await call(owner, 'post', `/api/workspaces/${workspace.id}/members/invitations`, { email: accountant.email }).expect(201);
  const token = new URL(response.body.invitationUrl).searchParams.get('invite');
  await call(accountant, 'post', '/api/auth/invitations/accept', { token }).expect(200); return token;
}

it('stores salted password hashes and opaque hashed sessions, with protected cookies and no client-selected role', async () => {
  const a = await register(), b = await register();
  const first = await User.findById(a.user.id).select('+passwordHash'); const second = await User.findById(b.user.id).select('+passwordHash');
  expect(first.passwordHash).not.toBe(password); expect(first.passwordHash).not.toBe(second.passwordHash);
  expect(a.response.headers['set-cookie'][0]).toContain('HttpOnly'); expect(a.response.headers['set-cookie'][0]).toContain('SameSite=Strict');
  const stored = await AuthSession.findOne({ userId: a.user.id });
  expect(stored.tokenHash).toBe(tokenHash(a.cookie.split('=')[1])); expect(a.response.body.user.passwordHash).toBeUndefined();
  await request(app).post('/api/auth/register').send({ name: 'Attacker', email: 'bad@example.test', password, role: 'owner' }).expect(400);
  await request(app).post('/api/auth/login').send({ email: { $ne: null }, password }).expect(400);
  const login = await request(app).post('/api/auth/login').send({ email: a.email, password }).expect(200);
  expect(login.headers['set-cookie'][0].split(';')[0]).not.toBe(a.cookie);
  await request(app).post('/api/auth/login').send({ email: a.email, password: 'wrong' }).expect(401);
});

it('uses Secure host-only cookies in production', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const owner = await register(); const cookie = owner.response.headers['set-cookie'][0];
  expect(cookie.startsWith('__Host-cashflow_session=')).toBe(true); expect(cookie).toContain('Secure'); expect(cookie).not.toContain('Domain=');
});

it('protects every business API family from anonymous access even with demo/local/shared-token flags', async () => {
  const { wa } = await setup(); const base = `/api/workspaces/${wa.id}`;
  app.locals.demoMode = true; app.locals.localSyntheticDev = true;
  vi.stubEnv('FEATURE_ADMIN_TOKEN', 'legacy'); vi.stubEnv('TALLY_SYNC_TOKEN', 'legacy'); vi.stubEnv('TALLY_SYNC_WORKSPACE_ID', wa.id); vi.stubEnv('OBSERVATION_TOKEN', 'legacy');
  const routes = [['get', base], ['get', '/api/workspaces'], ['post', '/api/workspaces'], ['patch', base],
    ['get', `${base}/items`], ['post', `${base}/items`], ['get', `${base}/recurring-rules`], ['post', `${base}/imports/inspect`],
    ['get', `${base}/bank`], ['get', `${base}/promises`], ['get', `${base}/forecast`], ['get', `${base}/spending-check`],
    ['post', `${base}/rescue/analyze`], ['get', `${base}/rescue/plans`], ['post', `${base}/orders/analyze`], ['get', `${base}/orders/scenarios`],
    ['post', `${base}/shock/analyze`], ['post', `${base}/shock/explain`], ['post', `${base}/copilot/chat`], ['get', `${base}/sync/devices`],
    ['get', `${base}/sync/status`], ['post', `${base}/sync/batches`], ['get', `${base}/reliability/consent`], ['post', `${base}/reliability/observations`],
    ['get', `${base}/reliability/buyers/22AAAAA0000A1Z5`], ['post', `${base}/offers/preview`], ['get', `${base}/followups`], ['get', `${base}/members`]];
  for (const [method, path] of routes) await request(app)[method](path).set('Authorization', 'Bearer legacy').send({}).expect(401);
  await request(app).post('/api/followup-automation/claim').set('Authorization', 'Bearer legacy').expect(401);
  await request(app).post('/api/webhooks/razorpay').send({}).expect(401);
}, 20000);

it('denies cross-business URLs and excludes other businesses from lists regardless of supplied headers', async () => {
  const { a, wa, wb, ib } = await setup(); const base = `/api/workspaces/${wb.id}`;
  const paths = ['', '/items', '/recurring-rules', '/bank', '/promises', '/forecast', '/spending-check', '/rescue/plans', '/orders/scenarios', '/sync/devices', '/sync/status', '/reliability/consent', '/followups', '/members'];
  for (const path of paths) await call(a, 'get', `${base}${path}`).set('X-Workspace-Id', wa.id).set('X-Role', 'owner').expect(404);
  for (const path of ['/items', '/imports/inspect', '/bank/imports/inspect', `/items/${ib._id}/promises`, '/rescue/analyze', '/orders/analyze', '/shock/analyze', '/copilot/chat', '/offers/preview'])
    await call(a, 'post', `${base}${path}`, {}).expect(404);
  await call(a, 'patch', `${base}/items/${ib._id}`, { amountPaise: 1 }).expect(404);
  await call(a, 'delete', `${base}/items/${ib._id}`).expect(404);
  const list = (await call(a, 'get', '/api/workspaces').expect(200)).body.workspaces;
  expect(list.map(w => w.id)).toEqual([wa.id]); expect(JSON.stringify(list)).not.toContain('SECRET-B');
}, 20000);

it('scopes nested record IDs inside an authorized business, including imports, matching and saved analyses', async () => {
  const { a, wa, wb, ib } = await setup(); const own = `/api/workspaces/${wa.id}`;
  const batch = await ImportBatch.create({ workspaceId: wb.id, kind: 'receivables', sourceSystem: 'csv', status: 'validated', rawRows: [] });
  const bank = await BankTransaction.create({ workspaceId: wb.id, accountKey: 'B', transactionId: 'B-UTR', identity: randomUUID(), date: '2026-11-03', creditPaise: 10000, debitPaise: 0 });
  const scenario = await OrderScenario.create({ workspaceId: wb.id, label: 'B order', orderValuePaise: 10000, advancePaise: 0, advanceDate: '2026-11-02', finalCollectionDate: '2026-11-20' });
  const plan = await RescuePlan.create({ workspaceId: wb.id, asOfDate: '2026-11-01', objective: 'nonnegative', baselineWorstCashPaise: -1, simulatedWorstCashPaise: 0, estimatedTotalCostPaise: 0, containsUnknownCosts: false,
    feasibility: 'conditional', actions: [{ actionId: 'a', cashItemId: ib._id, type: 'accelerate_collection', amountPaise: 1000, fromDate: '2026-11-10', toDate: '2026-11-03' }] });
  await call(a, 'patch', `${own}/items/${ib._id}`, { counterparty: 'stolen' }).expect(404);
  await call(a, 'post', `${own}/imports/${batch._id}/commit`, {}).expect(404);
  await call(a, 'post', `${own}/bank/${bank._id}/match`, { requestId: randomUUID(), cashItemId: String(ib._id), amountPaise: 1 }).expect(404);
  await call(a, 'post', `${own}/orders/scenarios/${scenario._id}/recalculate`, {}).expect(404);
  await call(a, 'patch', `${own}/rescue/plans/${plan._id}/actions/a`, { status: 'rejected' }).expect(404);
  await call(a, 'post', `${own}/offers/preview`, { cashItemId: String(ib._id), discountBps: 0, settleBy: '2026-11-03', phone: '919999999999' }).expect(404);
  expect((await CashItem.findById(ib._id)).counterparty).toBe('SECRET-B invoice');
});

it('permits accountant bookkeeping while enforcing owner-only settings, access, deletion and integrations', async () => {
  const { a, wa, ia } = await setup(); const accountant = await register('Accountant'); await invite(a, wa, accountant);
  const base = `/api/workspaces/${wa.id}`;
  expect((await call(accountant, 'get', '/api/workspaces')).body.workspaces[0].role).toBe('accountant');
  await call(accountant, 'get', `${base}/forecast`).expect(200);
  await call(accountant, 'patch', `${base}/items/${ia._id}`, { description: 'Accountant note' }).expect(200);
  await call(accountant, 'post', `${base}/items`, { category: 'expense', counterparty: 'Rent', amountPaise: 1000, dueDate: '2026-11-02', expectedDate: '2026-11-02' }).expect(201);
  await call(accountant, 'post', `${base}/orders/analyze`, { orderValuePaise: 10000, advancePaise: 0, advanceDate: '2026-11-02', finalCollectionDate: '2026-11-20', costLines: [] }).expect(200);
  const denials = [['patch', '', { minimumReservePaise: 0 }], ['delete', `/items/${ia._id}`], ['get', '/members'], ['post', '/members/invitations', { email: 'another@example.test' }],
    ['post', '/sync/devices', { name: 'Unauthorized' }], ['get', '/sync/status'], ['patch', '/reliability/consent', { share: true }], ['get', '/followups'], ['post', '/offers/preview', {}]];
  for (const [method, path, body] of denials) await call(accountant, method, `${base}${path}`, body).set('X-Role', 'owner').expect(403);
  await call(a, 'delete', `${base}/members/${accountant.user.id}`).expect(204);
  await call(accountant, 'get', `${base}/forecast`).expect(404);
}, 20000);

it('binds invitations to email, supports revocation/expiry and consumes them atomically', async () => {
  const owner = await register(), accountant = await register('Accountant'), wrong = await register('Wrong account'); const w = await business(owner);
  const create = async () => (await call(owner, 'post', `/api/workspaces/${w.id}/members/invitations`, { email: accountant.email })).body;
  let invitation = await create(); let token = new URL(invitation.invitationUrl).searchParams.get('invite');
  await call(wrong, 'post', '/api/auth/invitations/accept', { token }).expect(400);
  const pending = (await call(owner, 'get', `/api/workspaces/${w.id}/members`)).body.invitations[0];
  await call(owner, 'delete', `/api/workspaces/${w.id}/invitations/${pending.id}`).expect(204);
  await call(accountant, 'post', '/api/auth/invitations/accept', { token }).expect(400);
  invitation = await create(); token = new URL(invitation.invitationUrl).searchParams.get('invite');
  await Workspace.updateOne({ _id: w.id }, { $set: { 'invitations.0.expiresAt': new Date(0) } });
  await call(accountant, 'post', '/api/auth/invitations/accept', { token }).expect(400);
  invitation = await create(); token = new URL(invitation.invitationUrl).searchParams.get('invite');
  const attempts = await Promise.all([call(accountant, 'post', '/api/auth/invitations/accept', { token }), call(accountant, 'post', '/api/auth/invitations/accept', { token })]);
  expect(attempts.map(r => r.status).sort()).toEqual([200, 400]);
  expect((await Workspace.findById(w.id)).members).toHaveLength(1);
}, 20000);

it('rejects missing/wrong CSRF tokens and untrusted origins while allowing the configured client', async () => {
  const owner = await register();
  await request(app).post('/api/workspaces').set('Cookie', owner.cookie).send({}).expect(403);
  await request(app).post('/api/workspaces').set('Cookie', owner.cookie).set('X-CSRF-Token', '0'.repeat(64)).send({}).expect(403);
  await call(owner, 'post', '/api/workspaces', { name: 'X', asOfDate: '2026-11-01', openingCashPaise: 0 }).set('Origin', 'https://attacker.example').expect(403);
  await request(app).post('/api/auth/login').set('Origin', 'https://attacker.example').send({ email: owner.email, password }).expect(403);
  const response = await call(owner, 'get', '/api/auth/me').set('Origin', 'https://attacker.example').expect(200);
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
  const allowed = await call(owner, 'get', '/api/auth/me').set('Origin', 'http://localhost:5173').expect(200);
  expect(allowed.headers['access-control-allow-credentials']).toBe('true'); expect(allowed.headers['cache-control']).toBe('no-store');
});

it('revokes logout, expired and disabled-account sessions and rotates all sessions on password change', async () => {
  const owner = await register();
  const login = await request(app).post('/api/auth/login').send({ email: owner.email, password }).expect(200);
  const second = { cookie: login.headers['set-cookie'][0].split(';')[0], csrfToken: login.body.csrfToken };
  const changed = await call(owner, 'post', '/api/auth/password', { currentPassword: password, newPassword: 'A different long password 99!' }).expect(200);
  await call(second, 'get', '/api/auth/me').expect(401); await call(owner, 'get', '/api/auth/me').expect(401);
  const latest = { cookie: changed.headers['set-cookie'][0].split(';')[0], csrfToken: changed.body.csrfToken };
  await call(latest, 'get', '/api/auth/me').expect(200);
  await call(latest, 'post', '/api/auth/logout', {}).expect(204); await call(latest, 'get', '/api/auth/me').expect(401);
  await request(app).post('/api/auth/login').send({ email: owner.email, password }).expect(401);
  const fresh = await register(); await AuthSession.updateMany({ userId: fresh.user.id }, { $set: { expiresAt: new Date(0) } }); await call(fresh, 'get', '/api/auth/me').expect(401);
  const disabled = await register(); await User.updateOne({ _id: disabled.user.id }, { disabled: true }); await call(disabled, 'get', '/api/auth/me').expect(401);
}, 20000);

it('throttles brute-force attempts without disclosing whether the account exists', async () => {
  const owner = await register();
  const missing = await request(app).post('/api/auth/login').send({ email: 'missing@example.test', password: 'wrong' }).expect(401);
  for (let i = 0; i < 12; i++) {
    const response = await request(app).post('/api/auth/login').send({ email: owner.email, password: 'wrong' }).expect(401);
    expect(response.body).toEqual(missing.body);
  }
  await request(app).post('/api/auth/login').send({ email: owner.email, password }).expect(429);
}, 20000);

it('scopes sync credentials to one business and one purpose and enforces revocation', async () => {
  const { a, wa, wb } = await setup(); const base = `/api/workspaces/${wa.id}`;
  const issued = (await call(a, 'post', `${base}/sync/devices`, { name: 'Tally device' }).expect(201)).body;
  const body = { companyId: 'A', batchId: randomUUID(), rows: [{ sourceId: 'source', version: '1', item: { category: 'receivable', counterparty: 'A buyer', sourceSystem: 'tally_export', amountPaise: 1000, dueDate: '2026-11-10', expectedDate: '2026-11-10' } }] };
  await request(app).post(`${base}/sync/batches`).set('Authorization', `Bearer ${issued.token}`).send(body).expect(200);
  await request(app).post(`/api/workspaces/${wb.id}/sync/batches`).set('Authorization', `Bearer ${issued.token}`).send(body).expect(401);
  await request(app).get(`${base}/items`).set('Authorization', `Bearer ${issued.token}`).expect(401);
  await request(app).post('/api/followup-automation/claim').set('Authorization', `Bearer ${issued.token}`).expect(401);
  await call(a, 'delete', `${base}/sync/devices/${issued.device.id}`).expect(204);
  await request(app).post(`${base}/sync/batches`).set('Authorization', `Bearer ${issued.token}`).send(body).expect(401);
});

it('keeps automation job claims, dispatch checks and acknowledgments within the credential’s business', async () => {
  const { a, b, wa, wb, ia, ib } = await setup(); vi.stubEnv('FOLLOWUP_ALLOW_SEND', '1');
  const credential = async (owner, w) => (await call(owner, 'post', `/api/workspaces/${w.id}/sync/devices`, { name: 'n8n', kind: 'automation' }).expect(201)).body.token;
  const tokenA = await credential(a, wa), tokenB = await credential(b, wb);
  const schedule = async (owner, w, item) => call(owner, 'post', `/api/workspaces/${w.id}/followups`, { cashItemId: String(item._id), phone: '919999999999', mode: 'n8n', recipientOptIn: true }).expect(201);
  await schedule(a, wa, ia); await schedule(b, wb, ib);
  const jobsA = (await request(app).post('/api/followup-automation/claim').set('Authorization', `Bearer ${tokenA}`).expect(200)).body.jobs;
  const jobsB = (await request(app).post('/api/followup-automation/claim').set('Authorization', `Bearer ${tokenB}`).expect(200)).body.jobs;
  expect(jobsA).toHaveLength(1); expect(jobsB).toHaveLength(1); expect(JSON.stringify(jobsA)).not.toContain('SECRET-B');
  const foreign = `/api/followup-automation/jobs/${jobsB[0].claimId}`;
  expect((await request(app).post(`${foreign}/validate`).set('Authorization', `Bearer ${tokenA}`).expect(200)).body.send).toBe(false);
  expect((await request(app).post(`${foreign}/ack`).set('Authorization', `Bearer ${tokenA}`).send({ outcome: 'accepted', providerMessageId: 'fake' }).expect(200)).body.recorded).toBe(false);
  expect((await CollectionFollowUp.findOne({ workspaceId: wb.id })).attempts).toBe(0);
  await request(app).post(`/api/workspaces/${wa.id}/sync/batches`).set('Authorization', `Bearer ${tokenA}`).send({}).expect(401);
}, 20000);

it('does not let a newly registered user claim an existing ownerless business', async () => {
  const legacy = await Workspace.create({ name: 'Unassigned private records', asOfDate: '2026-11-01', openingCashPaise: 0 });
  const user = await register(); app.locals.demoMode = true;
  await call(user, 'get', `/api/workspaces/${legacy._id}`).expect(404);
  await call(user, 'post', `/api/workspaces/${legacy._id}/claim`, {}).expect(404);
  expect((await call(user, 'get', '/api/workspaces')).body.workspaces).toEqual([]);
});

it('assigns legacy ownership only through the local administration script and refuses reassignment', async () => {
  const legacy = await Workspace.create({ name: 'Legacy business', asOfDate: '2026-11-01', openingCashPaise: 0 });
  const owner = await register(), stranger = await register();
  const script = fileURLToPath(new URL('../scripts/assign-business-owner.mjs', import.meta.url));
  const options = { env: { ...process.env, MONGODB_URI: mongo.getUri() }, timeout: 15000, windowsHide: true };
  await promisify(execFile)(process.execPath, [script, String(legacy._id), owner.email], options);
  await call(owner, 'get', `/api/workspaces/${legacy._id}`).expect(200);
  await expect(promisify(execFile)(process.execPath, [script, String(legacy._id), stranger.email], options)).rejects.toThrow();
  await call(stranger, 'get', `/api/workspaces/${legacy._id}`).expect(404);
  expect(String((await Workspace.findById(legacy._id)).ownerUserId)).toBe(owner.user.id);
}, 30000);

it('loads sample fixtures only into an owned empty business without exposing a shared seed business', async () => {
  const owner = await register(), stranger = await register(); const w = await business(owner);
  const endpoint = `/api/workspaces/${w.id}/demo-data`;
  await call(stranger, 'post', endpoint, {}).expect(404);
  await call(owner, 'post', endpoint, {}).expect(201);
  expect(await CashItem.countDocuments({ workspaceId: w.id })).toBeGreaterThan(0);
  await call(owner, 'post', endpoint, {}).expect(409);
});
