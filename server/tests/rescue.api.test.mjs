import { expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import rescueRouter, { createRescueRouter } from '../src/routes/rescue.js';
import ordersRouter, { createOrdersRouter } from '../src/routes/orders.js';
import { buildForecast } from './rescueForecastStub.mjs';
import { draftOrder, fixtureContext, isolatedContext } from './rescueFixtureSupport.mjs';

const id = '0123456789abcdef01234567';
function appFor(dependencies = {}) {
  const app = express(); app.use(express.json());
  const deps = { loadContext: async () => fixtureContext(), buildForecast, logError: vi.fn(), ...dependencies };
  app.use('/api/workspaces/:workspaceId/rescue', createRescueRouter(deps));
  app.use('/api/workspaces/:workspaceId/orders', createOrdersRouter(deps));
  return app;
}
test('default exports are Express routers without eagerly loading missing Person 1 modules', () => {
  expect(typeof rescueRouter).toBe('function'); expect(typeof ordersRouter).toBe('function');
});
test('rescue endpoint preserves parent workspace params and returns real engine output', async () => {
  const loadContext = vi.fn(async () => fixtureContext());
  const response = await request(appFor({ loadContext })).post(`/api/workspaces/${id}/rescue/analyze`).send({ objective: 'nonnegative', maxCandidates: 12, maxPlans: 3 });
  expect(response.status).toBe(200);
  expect(loadContext).toHaveBeenCalledWith(id);
  expect(response.body.baseline.worstCashPaise).toBe(-20_000_000);
  expect(response.body.plans.length).toBeGreaterThan(0);
  expect(response.body.plans.every(plan => plan.daily.length === 90)).toBe(true);
});
test('order endpoint computes minimum advance and treats records as read-only', async () => {
  const context = isolatedContext(); const before = structuredClone(context);
  const response = await request(appFor({ loadContext: async () => context })).post(`/api/workspaces/${id}/orders/analyze`).send(draftOrder());
  expect(response.status).toBe(200);
  expect(response.body.minimumAdvance.amountPaise).toBe(40_000_000);
  expect(context).toEqual(before);
});
test('missing workspace returns structured 404', async () => {
  for (const feature of ['rescue', 'orders']) {
    const response = await request(appFor({ loadContext: async () => null })).post(`/api/workspaces/${id}/${feature}/analyze`).send(feature === 'rescue' ? {} : draftOrder());
    expect(response.status).toBe(404); expect(response.body.error.code).toBe('NOT_FOUND');
  }
});
test('invalid IDs and invalid bodies return field errors before database access', async () => {
  const loadContext = vi.fn(); const app = appFor({ loadContext });
  for (const [path, body] of [
    ['/api/workspaces/invalid/rescue/analyze', {}],
    [`/api/workspaces/${id}/rescue/analyze`, { maxCandidates: 99 }],
    [`/api/workspaces/${id}/rescue/analyze`, []],
    [`/api/workspaces/${id}/orders/analyze`, { ...draftOrder(), advanceDate: '2026-02-30' }],
    [`/api/workspaces/${id}/orders/analyze`, { ...draftOrder(), costLines: [null] }],
  ]) {
    const response = await request(app).post(path).send(body);
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBeTruthy();
  }
  expect(loadContext).not.toHaveBeenCalled();
});
test('internal errors are logged and never leaked as client validation errors', async () => {
  const logError = vi.fn();
  const response = await request(appFor({ loadContext: async () => { throw new TypeError('secret connection string'); }, logError })).post(`/api/workspaces/${id}/rescue/analyze`).send({});
  expect(response.status).toBe(500); expect(response.body.error.code).toBe('INTERNAL_ERROR');
  expect(JSON.stringify(response.body)).not.toContain('secret'); expect(logError).toHaveBeenCalledOnce();
});

test('model adapter scopes all reads to the workspace and loads active recurring rules', async () => {
  const { createDecisionContextLoader } = await import('../src/services/rescue/decisionContext.js');
  const Workspace = { findById: vi.fn(() => ({ lean: async () => ({ asOfDate: '2026-11-01', openingCashPaise: 1 }) })) };
  const CashItem = { find: vi.fn(() => ({ lean: async () => [{ _id: 'invoice', constraints: { negotiable: true } }] })) };
  const RecurringRule = { find: vi.fn(() => ({ lean: async () => [] })) };
  const context = await createDecisionContextLoader({ Workspace, CashItem, RecurringRule })(id);
  expect(Workspace.findById).toHaveBeenCalledWith(id);
  expect(CashItem.find).toHaveBeenCalledWith({ workspaceId: id });
  expect(RecurringRule.find).toHaveBeenCalledWith({ workspaceId: id, active: true });
  expect(context.cashItems[0].id).toBe('invoice');
  expect(context.minimumReservePaise).toBe(0);
});
