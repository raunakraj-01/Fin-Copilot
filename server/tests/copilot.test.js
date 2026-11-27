import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from './authenticatedRequest.js';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import { maskPII } from '../src/services/ai/copilot.js';

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent: generateContentMock };
    }
  },
}));

let mongo, workspaceId;
afterEach(() => {
  generateContentMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
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

it('answers through Gemini RAG with only the selected workspace records', async () => {
  vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
  generateContentMock
    .mockResolvedValueOnce({ text: 'collections' })
    .mockResolvedValueOnce({ text: 'Surya Plastics owes ₹200.00.' });
  const other = await Workspace.create({ name: 'Other tenant', asOfDate: '2026-11-01', openingCashPaise: 0 });
  await CashItem.create({ workspaceId: other._id, category: 'payable', counterparty: 'Private Other Buyer', sourceSystem: 'manual', amountPaise: 99900, dueDate: '2026-11-05' });
  const response = await request(app).post(`/api/workspaces/${workspaceId}/copilot/chat`)
    .send({ sessionId: crypto.randomUUID(), message: 'Who owes us money?' }).expect(200);
  expect(response.text).toContain('"mode":"gemini-rag"');
  expect(response.text).toContain('Surya Plastics owes');
  const prompt = generateContentMock.mock.calls[1][0].contents;
  expect(prompt).toContain('Surya Plastics');
  expect(prompt).not.toContain('Private Other Buyer');
  expect(prompt).toContain('200.00');
});

it('falls back to deterministic offline-rag when Gemini fails', async () => {
  vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
  generateContentMock.mockRejectedValue(new Error('offline'));
  const response = await request(app).post(`/api/workspaces/${workspaceId}/copilot/chat`)
    .send({ sessionId: crypto.randomUUID(), message: 'Surya Plastics overdue?' }).expect(200);
  expect(response.text).toContain('₹200.00');
  expect(response.text).toContain('"mode":"offline-rag"');
});

it('retrieves relevant knowledge units and attaches sources in RAG response', async () => {
  vi.stubEnv('GEMINI_API_KEY', '');
  const response = await request(app).post(`/api/workspaces/${workspaceId}/copilot/chat`)
    .send({ sessionId: crypto.randomUUID(), message: 'What is the payment status for Surya Plastics?' }).expect(200);
  expect(response.text).toContain('"sources":');
  expect(response.text).toContain('Surya Plastics');
  expect(response.text).toContain('₹200.00');
});
