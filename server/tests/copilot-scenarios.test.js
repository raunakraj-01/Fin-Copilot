import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import { answerChat } from '../src/services/ai/copilot.js';

let mongo, workspaceId;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // Workspace with opening cash of ₹10,000 (1000000 paise) and safety reserve of ₹5,000 (500000 paise)
  const workspace = await Workspace.create({
    name: 'Scenario Test Workspace',
    asOfDate: '2026-11-01',
    openingCashPaise: 1000000,
    minimumReservePaise: 500000,
  });
  workspaceId = String(workspace._id);
  await CashItem.create({
    workspaceId,
    category: 'receivable',
    counterparty: 'Acme Traders',
    sourceSystem: 'manual',
    amountPaise: 2500000,
    dueDate: '2026-11-20',
  });
}, 600_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it('correctly stress-tests debt vs delayed order scenario and identifies solvency risk', async () => {
  const message = 'I am getting an order worth 50000 but I am already in a debt of 30000, what if the payment will be delayed. Will it lead to stoppage of my company?';
  const result = await answerChat(workspaceId, {
    message,
    sessionId: 'test-scenario-session',
  });

  expect(result).toBeDefined();
  expect(result.tool).toMatch(/simulate_scenario|scenario|simulate_order/);
  // Must mention the numbers and risk
  expect(result.reply).toContain('50,000');
  expect(result.reply).toContain('30,000');
  // Must offer concrete mitigation (advance / MSMED Act)
  expect(result.reply).toMatch(/advance|MSMED|milestone/i);
  // Must NOT give the old robotic refusal
  expect(result.reply).not.toContain('Use New Order Analyzer');
  expect(result.reply).not.toContain('retrieved financial records do not contain');
});

it('handles conversational follow-up questions referencing prior scenario', async () => {
  const sessionId = 'test-conversation-session';
  await answerChat(workspaceId, {
    message: 'What if Acme Traders delays their payment?',
    sessionId,
  });

  const followUp = await answerChat(workspaceId, {
    message: 'Can I afford to pay my supplier next week if they do?',
    sessionId,
  });

  expect(followUp).toBeDefined();
  expect(followUp.reply).not.toContain('Use New Order Analyzer');
  expect(followUp.reply.length).toBeGreaterThan(20);
});
