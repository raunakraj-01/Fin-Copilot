import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import { maskPII } from '../src/services/ai/copilot.js';

let mongo, workspaceId;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const workspace = await Workspace.create({ name: 'Chat fixture', asOfDate: '2026-11-01', openingCashPaise: 10000, minimumReservePaise: 0 });
  workspaceId = String(workspace._id);
  await CashItem.create({ workspaceId, category: 'receivable', counterparty: 'Surya Plastics', sourceSystem: 'manual', amountPaise: 20000, dueDate: '2026-10-20', expectedDate: '2026-11-05' });
}, 600_000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

it('masks financial identifiers before model transit', () => {
  expect(maskPII('1234567890123456 22AAAAA0000A1Z5 HDFC0123456')).toBe('[ACCOUNT] [GSTIN] [IFSC]');
});

it('streams grounded collections and resolves the same debtor in a follow-up', async () => {
  vi.stubEnv('OLLAMA_MODEL', '');
  vi.stubEnv('GEMINI_API_KEY', '');
  const sessionId = crypto.randomUUID();
  const base = `/api/workspaces/${workspaceId}/copilot/chat`;
  const first = await request(app).post(base).send({ sessionId, message: 'Surya Plastics overdue?' }).expect(200);
  expect(first.headers['content-type']).toMatch(/text\/event-stream/);
  expect(first.text).toContain('₹200.00');
  const second = await request(app).post(base).send({ sessionId, message: 'Send them a message' }).expect(200);
  expect(second.text).toContain('Draft for Surya Plastics');
  expect(second.text).toContain('₹200.00');
  expect(await CashItem.countDocuments({ workspaceId })).toBe(1);
});

it('answers through local Ollama with only the selected workspace records', async () => {
  vi.stubEnv('OLLAMA_MODEL', 'demo-model');
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'Surya Plastics owes ₹200.00.' } }) });
  vi.stubGlobal('fetch', fetchMock);
  const other = await Workspace.create({ name: 'Other tenant', asOfDate: '2026-11-01', openingCashPaise: 0 });
  await CashItem.create({ workspaceId: other._id, category: 'payable', counterparty: 'Private Other Buyer', sourceSystem: 'manual', amountPaise: 99900, dueDate: '2026-11-05' });
  const response = await request(app).post(`/api/workspaces/${workspaceId}/copilot/chat`)
    .send({ sessionId: crypto.randomUUID(), message: 'Who owes us money?' }).expect(200);
  expect(response.text).toContain('"mode":"ollama"');
  expect(response.text).toContain('Surya Plastics owes');
  const [url, options] = fetchMock.mock.calls[0];
  expect(String(url)).toBe('http://127.0.0.1:11434/api/chat');
  const body = JSON.parse(options.body);
  expect(body.model).toBe('demo-model');
  expect(options.body).toContain('Surya Plastics');
  expect(options.body).not.toContain('Private Other Buyer');
  expect(options.body).toContain('20000');
});

it('returns a labeled calculated fallback when local Ollama fails', async () => {
  vi.stubEnv('OLLAMA_MODEL', 'demo-model');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const response = await request(app).post(`/api/workspaces/${workspaceId}/copilot/chat`)
    .send({ sessionId: crypto.randomUUID(), message: 'Surya Plastics overdue?' }).expect(200);
  expect(response.text).toContain('₹200.00');
  expect(response.text).toContain('"mode":"offline"');
  expect(response.text).toContain('modelWarning');
});
