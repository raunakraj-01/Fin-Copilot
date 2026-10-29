import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import app from '../src/app.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import { maskPII } from '../src/services/ai/copilot.js';

let mongo, workspaceId;
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
