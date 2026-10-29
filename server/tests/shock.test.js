import { expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { fixtureContext } from './rescueFixtureSupport.mjs';
import { buildForecast } from '../src/services/finance/forecast.js';
import { analyzeShock, delayReceipts } from '../src/services/finance/shock.js';
import { explainReport } from '../src/services/finance/explain.js';
import { actionFeeEvents, applyActions, makeCandidates } from '../src/services/rescue/analyze.js';
import { prepareSavedPlan } from '../src/services/rescue/savePlan.js';
import { createShockRouter } from '../src/routes/shock.js';
import { parseUpload, suggestMapping } from '../src/services/imports/parse.js';
import { normalizeRows } from '../src/services/imports/normalize.js';

const options = { counterparty: 'Acme Retail Pvt Ltd', delayDays: 7 };
const report = () => analyzeShock(fixtureContext(), options, buildForecast);

test('fees reduce cash on the entered date and browser-supplied fees are ignored when saving', () => {
  const context = fixtureContext();
  context.cashItems.forEach((item, index) => { item.id = String(index + 1).padStart(24, '0'); });
  context.cashItems[0].constraints.actionCostDate = '2026-11-10';
  const action = makeCandidates(context).find(action => action.externalId === 'INV-R100');
  const events = actionFeeEvents(context, [action]);
  expect(events[0]).toMatchObject({ date: '2026-11-10', amountPaise: 300_000, cashItemId: action.cashItemId });
  const forecast = buildForecast({ ...context, cashItems: applyActions(context, [action]), additionalEvents: events });
  expect(forecast.daily.find(day => day.date === '2026-11-04').paymentsPaise).toBe(0);
  expect(forecast.daily.find(day => day.date === '2026-11-10').paymentsPaise).toBe(300_000);
  const saved = prepareSavedPlan(context, { objective: 'nonnegative', actions: [{ ...action, feeDate: '2027-12-31', estimatedCostPaise: 0 }] }, buildForecast);
  expect(saved.simulatedWorstCashPaise).toBe(-300_000);
  expect(saved.actions[0].feeDate).toBe('2026-11-10');
  expect(saved.actions[0].estimatedCostPaise).toBe(300_000);
  expect(saved.feasibility).toBe('insufficient');
});

test('known fees cannot be silently hidden outside the forecast', () => {
  for (const date of ['2026-11-01', '2027-12-31']) {
    const context = fixtureContext(); context.cashItems[0].constraints.actionCostDate = date;
    expect(() => analyzeShock(context, options, buildForecast)).toThrow(/fees must fall/);
  }
});

test('fee dates import through header mapping and invalid dates are rejected', async () => {
  const file = await parseUpload({ originalname: 'fees.csv', buffer: Buffer.from('Invoice ID,Customer,Amount INR,Due Date,Expected Date,Fee Payment Date\nI,Buyer,100,2026-11-10,2026-11-20,2026-11-05') });
  const mapping = suggestMapping(file.headers);
  const rows = normalizeRows(file.rawRows, mapping, 'receivables', 'csv');
  expect(rows[0].item.constraints.actionCostDate).toBe('2026-11-05');
  file.rawRows[0].values['Fee Payment Date'] = '2026-02-30';
  expect(normalizeRows(file.rawRows, mapping, 'receivables', 'csv')[0].state).toBe('rejected');
});

test('stress moves both portions of an accelerated receipt and preserves mandatory payments and fees', () => {
  const context = fixtureContext(); const before = structuredClone(context);
  const result = analyzeShock(context, options, buildForecast);
  const plan = result.plans.find(plan => plan.actions.length === 2);
  const delayed = plan.scenarios.find(scenario => scenario.delayDays === 7);
  expect(plan.daily.find(day => day.date === '2026-11-04').receiptsPaise).toBe(20_000_000);
  expect(delayed.daily.find(day => day.date === '2026-11-04').receiptsPaise).toBe(0);
  expect(delayed.daily.find(day => day.date === '2026-11-04').paymentsPaise).toBe(300_000);
  expect(delayed.daily.find(day => day.date === '2026-11-11').receiptsPaise).toBe(20_000_000);
  expect(delayed.daily.find(day => day.date === '2026-11-11').paymentsPaise).toBe(10_000_000);
  expect(delayed.daily.find(day => day.date === '2026-12-03').receiptsPaise).toBe(20_000_000);
  expect(delayed.passes).toBe(false);
  expect(result.baseline.worstCashPaise).toBe(-20_000_000);
  expect(context).toEqual(before);
});

test('all invoices from one customer shift together, other customers and paid items do not', () => {
  const context = fixtureContext();
  context.cashItems[1].counterparty = options.counterparty;
  const paid = { ...context.cashItems[0], id: 'paid', status: 'paid' };
  const shifted = delayReceipts([...context.cashItems, paid], options.counterparty, 15, context.asOfDate);
  expect(shifted[0].expectedDate).toBe('2026-12-11');
  expect(shifted[1].expectedDate).toBe('2026-12-25');
  expect(shifted[2].expectedDate).toBe(context.cashItems[2].expectedDate);
  expect(shifted.at(-1).expectedDate).toBe(paid.expectedDate);
});

test('receipts moved outside the horizon are disclosed, not dropped from evidence', () => {
  const context = fixtureContext(); context.horizonDays = 30;
  const result = analyzeShock(context, { ...options, delayDays: 30 }, buildForecast);
  expect(result.movedReceipts[0]).toMatchObject({ toDate: '2026-12-26', outsideHorizon: true, amountPaise: 40_000_000 });
  expect(result.warnings.join(' ')).toContain('beyond the forecast');
  expect(result.stressed.daily.reduce((total, day) => total + day.receiptsPaise, 0)).toBe(0);
});

test('collection cards include fees, report remaining gaps and cite their original invoices', () => {
  const result = report();
  expect(result.priorities[0]).toMatchObject({ externalId: 'INV-R100', remainingGapPaise: 300_000, peakGapReductionPaise: 19_700_000, estimatedCostPaise: 300_000 });
  expect(result.priorities[0].breachDaysReduced).toBeGreaterThan(0);
  expect(result.sources.some(source => source.id === result.priorities[0].cashItemId)).toBe(true);
});

test('missing dates and review records cannot be made to appear collectible by stress', () => {
  const context = fixtureContext();
  context.cashItems[0].confidenceState = 'needs_review';
  context.cashItems[1].expectedDate = undefined;
  const result = analyzeShock(context, {}, buildForecast);
  expect(result.customers).toEqual([]);
  expect(result.movedReceipts).toEqual([]);
  expect(result.priorities).toEqual([]);
  expect(result.warnings.join(' ')).toContain('verification');
});

test('reserve objective and no-data scenarios use the same engine', () => {
  const context = fixtureContext(); context.cashItems = []; context.minimumReservePaise = 30_000_000;
  const result = analyzeShock(context, {}, buildForecast);
  expect(result.baseline.peakGapPaise).toBe(10_000_000);
  expect(result.stressed.breachDays).toBe(90);
  expect(result.plans).toEqual([]);
});

test('AI-disabled explanations are complete and cite only real records', async () => {
  for (const question of ['shortage', 'collection', 'stress']) {
    const result = await explainReport(report(), question, { apiKey: '', model: '' });
    expect(result.mode).toBe('fallback');
    expect(result.facts.length).toBeGreaterThan(1);
    expect(result.facts.flatMap(fact => fact.sourceIds).every(id => result.sources.some(source => source.id === id))).toBe(true);
  }
});

const aiResponse = factIds => ({ ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ factIds }) }] }] }) });
test('AI selects verified facts through a bounded server-side request', async () => {
  const fetchImpl = vi.fn(async () => aiResponse(['baseline', 'breach', 'fees']));
  const result = await explainReport(report(), 'shortage', { apiKey: 'test-secret', model: 'test-model', fetchImpl });
  expect(result.mode).toBe('ai');
  expect(result.facts[0].text).toContain('2,00,000');
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/responses');
  expect(JSON.parse(init.body).store).toBe(false);
  expect(init.signal).toBeDefined();
  expect(JSON.stringify(result)).not.toContain('test-secret');
});

test('AI failure, forged evidence, omission, refusal and invalid JSON fall back safely', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('Timeout'); }, async () => ({ ok: false }),
    async () => aiResponse(['invented', 'fees']), async () => aiResponse(['baseline']),
    async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }) }),
    async () => ({ ok: true, json: async () => ({ status: 'incomplete' }) }),
  ]) {
    const result = await explainReport(report(), 'shortage', { apiKey: 'x', model: 'm', fetchImpl });
    expect(result.mode).toBe('fallback');
    expect(result.facts[0].id).toBe('baseline');
  }
});

test('shock routes validate before reads, scope customers, await explanations and handle missing workspaces', async () => {
  const loadContext = vi.fn(async () => fixtureContext());
  const app = express(); app.use(express.json());
  app.use('/api/workspaces/:workspaceId/shock', createShockRouter({ loadContext, buildForecast, ai: { apiKey: '' } }));
  const base = '/api/workspaces/0123456789abcdef01234567/shock';
  for (const body of [{ delayDays: 14 }, { delayDays: '7' }, { counterparty: '' }, { unknown: true }]) await request(app).post(`${base}/analyze`).send(body).expect(400);
  await request(app).post('/api/workspaces/bad/shock/analyze').send({}).expect(400);
  expect(loadContext).not.toHaveBeenCalled();
  await request(app).post(`${base}/analyze`).send({ counterparty: 'Another workspace customer' }).expect(400);
  const result = await request(app).post(`${base}/analyze`).send(options).expect(200);
  expect(result.body.baseline.worstCashPaise).toBe(-20_000_000);
  const explanation = await request(app).post(`${base}/explain`).send({ ...options, question: 'stress' }).expect(200);
  expect(explanation.body.facts[0].id).toBe('stress');
  await request(app).post(`${base}/explain`).send({ ...options, question: 'execute_payment' }).expect(400);
  loadContext.mockResolvedValue(null);
  await request(app).post(`${base}/analyze`).send({}).expect(404);
});
