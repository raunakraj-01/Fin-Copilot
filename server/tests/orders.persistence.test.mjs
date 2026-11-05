import { expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOrdersRouter } from '../src/routes/orders.js';
import { createRescueRouter } from '../src/routes/rescue.js';
import { buildForecast } from '../src/services/finance/forecast.js';
import { draftOrder, isolatedContext } from './rescueFixtureSupport.mjs';

const workspaceId = '0123456789abcdef01234567';
const planId = '0123456789abcdef01234568';
function appFor(dependencies) {
  const app = express(); app.use(express.json());
  const deps = { buildForecast, workspaceExists: async () => true, loadContext: async () => isolatedContext(), logError: vi.fn(), ...dependencies };
  app.use('/api/workspaces/:workspaceId/orders', createOrdersRouter(deps));
  app.use('/api/workspaces/:workspaceId/rescue', createRescueRouter(deps));
  return app;
}

test('order saving recomputes minimum advance and ignores supplied financial output', async () => {
  const context = isolatedContext(); const before = structuredClone(context);
  const createScenario = vi.fn(async scenario => ({ _id: 'saved', ...scenario }));
  const response = await request(appFor({ loadContext: async () => context, createScenario }))
    .post(`/api/workspaces/${workspaceId}/orders/scenarios`)
    .send({ ...draftOrder(), label: ' ', simulatedMinimumAdvancePaise: 0, scenarioWarnings: [], costLines: [{ amountPaise: 50_000_000, paymentDate: '2026-11-11' }] });
  expect(response.status).toBe(201);
  expect(response.body.simulatedMinimumAdvancePaise).toBe(40_000_000);
  expect(response.body.label).toBe('Prospective order');
  expect(response.body.costLines[0].description).toBe('Order cost');
  expect(response.body.scenarioWarnings.join(' ')).toContain('Hypothetical');
  expect(context).toEqual(before);
  expect(createScenario).toHaveBeenCalledOnce();
});

test('an infeasible order saves a null threshold with its explanation', async () => {
  const response = await request(appFor({ loadContext: async () => isolatedContext(), createScenario: async value => value }))
    .post(`/api/workspaces/${workspaceId}/orders/scenarios`).send({ ...draftOrder(), advanceDate: '2026-11-12' });
  expect(response.status).toBe(201);
  expect(response.body.simulatedMinimumAdvancePaise).toBeNull();
  expect(response.body.scenarioWarnings.join(' ')).toContain('before the advance');
});

test('bad order dates cannot persist and missing workspace returns 404', async () => {
  const createScenario = vi.fn();
  const app = appFor({ loadContext: async () => isolatedContext(), createScenario });
  expect((await request(app).post(`/api/workspaces/${workspaceId}/orders/scenarios`).send({ ...draftOrder(), advanceDate: '2026-11-01' })).status).toBe(400);
  expect((await request(appFor({ loadContext: async () => null, createScenario })).post(`/api/workspaces/${workspaceId}/orders/scenarios`).send(draftOrder())).status).toBe(404);
  expect(createScenario).not.toHaveBeenCalled();
});

test('saved lists pass only the requested workspace to their stores', async () => {
  const listPlans = vi.fn(async () => []); const listScenarios = vi.fn(async () => []);
  const app = appFor({ listPlans, listScenarios });
  expect((await request(app).get(`/api/workspaces/${workspaceId}/rescue/plans`)).body.plans).toEqual([]);
  expect((await request(app).get(`/api/workspaces/${workspaceId}/orders/scenarios`)).body.scenarios).toEqual([]);
  expect(listPlans).toHaveBeenCalledWith(workspaceId); expect(listScenarios).toHaveBeenCalledWith(workspaceId);
});

test('action edits pass only validated status and notes with workspace and plan IDs', async () => {
  const updateAction = vi.fn(async () => ({ _id: planId, actions: [{ actionId: 'action-1', status: 'agreed' }] }));
  const response = await request(appFor({ updateAction })).patch(`/api/workspaces/${workspaceId}/rescue/plans/${planId}/actions/action-1`).send({ status: 'agreed', ownerNotes: 'Customer confirmed date' });
  expect(response.status).toBe(200);
  expect(updateAction).toHaveBeenCalledWith({ workspaceId, planId, actionId: 'action-1', update: { status: 'agreed', ownerNotes: 'Customer confirmed date' } });
});

test('action edits reject money changes, bad statuses and oversized notes before writing', async () => {
  const updateAction = vi.fn(); const app = appFor({ updateAction });
  for (const body of [{}, { status: 'paid' }, { amountPaise: 1 }, { ownerNotes: 'a'.repeat(2001) }, { status: 'completed', settledPaise: 20_000_000 }]) {
    expect((await request(app).patch(`/api/workspaces/${workspaceId}/rescue/plans/${planId}/actions/action-1`).send(body)).status).toBe(400);
  }
  expect(updateAction).not.toHaveBeenCalled();
  expect((await request(appFor({ updateAction: async () => null })).patch(`/api/workspaces/${workspaceId}/rescue/plans/${planId}/actions/action-1`).send({ ownerNotes: 'Follow up' })).status).toBe(404);
});
