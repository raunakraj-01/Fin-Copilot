import { afterAll, beforeAll, expect, it } from 'vitest';
import mongoose from 'mongoose';
import rawRequest from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import app from '../src/app.js';
import { todayIndia } from '../src/utils/dates.js';

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 600_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it('provisions a fresh Indian MSME demo workspace with zero Cash Outlook blockers and supports all features', async () => {
  const created = await request(app).post('/api/workspaces/demo').send({}).expect(201);
  expect(created.body.created).toBe(true);
  const ws = created.body.workspace;
  expect(ws.isDemo).toBe(true);
  expect(ws.asOfDate).toBe(todayIndia());
  expect(ws.name).toContain('Kalyani Precision Components');

  // Re-opening returns the same workspace without overwriting edits
  const reopened = await request(app).post('/api/workspaces/demo').send({}).expect(200);
  expect(reopened.body.created).toBe(false);
  expect(reopened.body.workspace.id).toBe(ws.id);

  const base = `/api/workspaces/${ws.id}`;

  // Forecast & Cash Desk have zero unresolved issues and fresh sync data
  const forecast = await request(app).get(`${base}/forecast`).expect(200);
  expect(forecast.body.daily).toHaveLength(90);
  expect(forecast.body.unresolvedIssues.totalCount).toBe(0);
  expect(forecast.body.dataFreshness.stale).toBe(false);
  expect(forecast.body.dataFreshness.lastSuccessfulSyncAt).toBeTruthy();

  // Spending Check has zero data blockers when commitments are confirmed (no "Unavailable")
  const spending = await request(app)
    .get(`${base}/spending-check?horizonDays=30&delayDays=7&commitmentsConfirmed=true&spendPaise=0`)
    .expect(200);
  expect(spending.body.status).toBe('conditional');
  expect(spending.body.dataQuality.complete).toBe(true);
  expect(spending.body.dataQuality.issues).toEqual([]);
  expect(spending.body.expected.spendablePaise).not.toBeNull();
  expect(spending.body.delayed.spendablePaise).not.toBeNull();
  expect(spending.body.recommendedSpendablePaise).not.toBeNull();

  // Rescue Planner produces feasible plans
  const rescue = await request(app)
    .post(`${base}/rescue/analyze`)
    .send({ objective: 'nonnegative', maxCandidates: 12, maxPlans: 3 })
    .expect(200);
  expect(rescue.body.plans.length).toBeGreaterThan(0);

  // Cash Shock Lab works with Indian customer names
  const shock = await request(app)
    .post(`${base}/shock/analyze`)
    .send({ delayDays: 15 })
    .expect(200);
  expect(shock.body.customers.length).toBeGreaterThan(0);
  expect(shock.body.priorities.length).toBeGreaterThan(0);

  // Payment Timing works from historical verified settlements
  const itemsRes = await request(app).get(`${base}/items`).expect(200);
  const tataInvoice = itemsRes.body.items.find(i => i.externalId === 'INV/FY27/204');
  expect(tataInvoice).toBeTruthy();
  const timing = await request(app)
    .get(`${base}/reliability/payment-timing/${tataInvoice.id}`)
    .expect(200);
  expect(timing.body.available).toBe(true);
  expect(timing.body.evidenceCount).toBeGreaterThanOrEqual(3);

  // Saved order scenario is current (not stale) and operational modules are populated
  const [scenarios, inventory, procurement, fulfillment, captures, promises] = await Promise.all([
    request(app).get(`${base}/orders/scenarios`).expect(200),
    request(app).get(`${base}/inventory`).expect(200),
    request(app).get(`${base}/procurement`).expect(200),
    request(app).get(`${base}/fulfillment`).expect(200),
    request(app).get(`${base}/captures`).expect(200),
    request(app).get(`${base}/promises`).expect(200),
  ]);
  expect(scenarios.body.scenarios).toHaveLength(1);
  expect(scenarios.body.scenarios[0].freshness.stale).toBe(false);
  expect(inventory.body.lowStockCount).toBe(1);
  expect(procurement.body.requests).toHaveLength(1);
  expect(fulfillment.body.orders).toHaveLength(1);
  expect(captures.body.captures).toHaveLength(1);
  expect(promises.body.items.some(i => i.promises.length > 0)).toBe(true);

  // Cash Copilot answers using grounded demo records
  const copilot = await request(app)
    .post(`${base}/copilot/chat`)
    .send({ message: 'Who owes me money?', sessionId: '11111111-1111-4111-8111-111111111111' })
    .expect(200);
  expect(copilot.text).toContain('event: answer');
  expect(copilot.text).toContain('Tata Motors');

  // Mutate workspace and verify reset restores clean demo state
  await request(app).patch(base).send({ openingCashPaise: 99_999_900 }).expect(200);
  const resetRes = await request(app).post('/api/workspaces/demo').send({ reset: true }).expect(200);
  expect(resetRes.body.reset).toBe(true);
  expect(resetRes.body.workspace.id).toBe(ws.id);
  expect(resetRes.body.workspace.openingCashPaise).toBe(42_500_000);
}, 60_000);

it('isolates demo workspaces per signed-in user and rejects anonymous requests', async () => {
  await rawRequest(app).post('/api/workspaces/demo').send({}).expect(401);

  const registerUser = async (email, name) => {
    const res = await rawRequest(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'Long test password 42!' })
      .expect(201);
    return {
      cookie: res.headers['set-cookie'][0].split(';')[0],
      csrfToken: res.body.csrfToken,
    };
  };

  const userA = await registerUser('demo-user-a@example.test', 'User A');
  const userB = await registerUser('demo-user-b@example.test', 'User B');

  const demoA = await rawRequest(app)
    .post('/api/workspaces/demo')
    .set('Cookie', userA.cookie)
    .set('X-CSRF-Token', userA.csrfToken)
    .send({})
    .expect(201);
  const demoB = await rawRequest(app)
    .post('/api/workspaces/demo')
    .set('Cookie', userB.cookie)
    .set('X-CSRF-Token', userB.csrfToken)
    .send({})
    .expect(201);

  expect(demoA.body.workspace.id).not.toBe(demoB.body.workspace.id);
  await rawRequest(app)
    .get(`/api/workspaces/${demoA.body.workspace.id}/forecast`)
    .set('Cookie', userB.cookie)
    .set('X-CSRF-Token', userB.csrfToken)
    .expect(404);
}, 60_000);
