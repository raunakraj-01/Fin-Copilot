import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import User from '../src/models/User.js';
import AuthAttempt from '../src/models/AuthAttempt.js';
import AuthSession from '../src/models/AuthSession.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import TelegramLink from '../src/models/TelegramLink.js';
import TelegramLinkCode from '../src/models/TelegramLinkCode.js';
import SecurityEvent from '../src/models/SecurityEvent.js';
import { resetRateLimiters } from '../src/middleware/rateLimit.js';
import { getTelegramWebhookSecret, resetTelegramRuntimeState } from '../src/services/ai/telegramCopilot.js';

let mongo;
let seq = 0;
let updateSeq = 1000;
const password = 'Strong Telegram Test Pass 99!';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    User.init(),
    AuthAttempt.init(),
    AuthSession.init(),
    Workspace.init(),
    TelegramLink.init(),
    TelegramLinkCode.init(),
    SecurityEvent.init(),
  ]);
}, 600_000);

beforeEach(async () => {
  resetRateLimiters();
  resetTelegramRuntimeState();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '123456:fake-telegram-token');
  vi.stubEnv('TELEGRAM_BOT_USERNAME', 'kavach_test_bot');
  vi.stubEnv('GEMINI_API_KEY', '');
  await Promise.all([
    AuthAttempt.deleteMany({}),
    TelegramLink.deleteMany({}),
    TelegramLinkCode.deleteMany({}),
    CashItem.deleteMany({}),
    Workspace.deleteMany({}),
    User.deleteMany({}),
    SecurityEvent.collection.deleteMany({}),
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function registerUser(name = 'Telegram Owner') {
  const email = `tg-${++seq}@company.example`;
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

async function createWorkspace(client, name, openingCashPaise = 250_000) {
  const res = await authed(client, 'post', '/api/workspaces', {
    name,
    asOfDate: '2026-11-10',
    openingCashPaise,
    minimumReservePaise: 50_000,
  }).expect(201);
  return res.body.workspace;
}

function mockTelegramFetch() {
  const sent = [];
  const fetchSpy = vi.fn(async (url, init) => {
    const target = String(url);
    if (target.includes('/sendMessage')) {
      const payload = JSON.parse(init.body);
      sent.push(payload);
    }
    return new Response(JSON.stringify({ ok: true, result: { username: 'kavach_test_bot' } }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchSpy);
  return sent;
}

function postWebhook({ chatId, text, type = 'private', username = 'owner_tg', secret = getTelegramWebhookSecret() }) {
  return request(app)
    .post('/api/webhooks/telegram')
    .set('X-Telegram-Bot-Api-Secret-Token', secret)
    .send({
      update_id: ++updateSeq,
      message: {
        message_id: updateSeq,
        from: { id: chatId, first_name: 'Owner', username },
        chat: { id: chatId, type },
        date: 1795860000,
        text,
      },
    });
}

it('rejects unauthenticated webhook calls and fails closed for unlinked Telegram chats', async () => {
  const sent = mockTelegramFetch();

  await postWebhook({ chatId: 9001, text: 'Who owes us money?', secret: 'wrong-secret' }).expect(401);
  expect(sent.length).toBe(0);

  const res = await postWebhook({ chatId: 9001, text: 'Who owes us money?' }).expect(200);
  expect(res.body.handled).toBe('unauthorized');
  expect(sent[0].text).toContain('not linked');
});

it('supports single-use OTP deep linking, group isolation, RAG queries, workspace switching, and deduplication', async () => {
  const sent = mockTelegramFetch();

  const alice = await registerUser('Alice');
  const bob = await registerUser('Bob');
  const aliceWs1 = await createWorkspace(alice, 'Alpha Packaging');
  const aliceWs2 = await createWorkspace(alice, 'Alpha Logistics');
  const bobWs = await createWorkspace(bob, 'Beta Steel');

  await CashItem.create([
    {
      workspaceId: aliceWs1.id,
      category: 'receivable',
      externalId: 'INV-ALPHA-1',
      counterparty: 'Sunrise Distributors',
      sourceSystem: 'manual',
      amountPaise: 150_000_00,
      dueDate: '2026-11-01',
      expectedDate: '2026-11-15',
      confidenceState: 'verified',
    },
    {
      workspaceId: bobWs.id,
      category: 'receivable',
      externalId: 'INV-BETA-9',
      counterparty: 'Secret Beta Customer',
      sourceSystem: 'manual',
      amountPaise: 999_000_00,
      dueDate: '2026-11-01',
      expectedDate: '2026-11-15',
      confidenceState: 'verified',
    },
  ]);

  // Cross-tenant link generation is rejected
  await authed(bob, 'post', `/api/workspaces/${aliceWs1.id}/telegram/link-code`, {}).expect(404);

  const issued = await authed(alice, 'post', `/api/workspaces/${aliceWs1.id}/telegram/link-code`, {}).expect(201);
  expect(issued.body.deepLink).toBe(`https://t.me/kavach_test_bot?start=${issued.body.code}`);

  // Group chat messages never expose financial data or consume code
  const groupRes = await postWebhook({ chatId: -5001, type: 'group', text: `/start ${issued.body.code}` }).expect(200);
  expect(groupRes.body.ignored).toBe('non_private_chat');

  // Redeem single-use code via /start <code>
  const linkRes = await postWebhook({ chatId: 7771, text: `/start ${issued.body.code}` }).expect(200);
  expect(linkRes.body.handled).toBe('linked');
  expect(sent.at(-1).text).toContain('Alpha Packaging');

  // Replay of same OTP code must fail
  const replayRes = await postWebhook({ chatId: 8888, text: `/link ${issued.body.code}` }).expect(200);
  expect(replayRes.body.handled).toBe('expired_link_code');

  // Status visible in web API (without exposing raw chat ID)
  const webStatus = await authed(alice, 'get', `/api/workspaces/${aliceWs1.id}/telegram/status`).expect(200);
  expect(webStatus.body.linked).toBe(true);
  expect(webStatus.body.link.maskedChatId).toBe('•••7771');

  // Ask RAG question — grounded strictly in Alpha Packaging, zero Beta Steel leak
  const ragRes = await postWebhook({ chatId: 7771, text: 'Which customers are overdue right now?' }).expect(200);
  expect(ragRes.body.handled).toBe('answered');
  const ragText = sent.at(-1).text;
  expect(ragText).toContain('Alpha Packaging');
  expect(ragText).toContain('Sunrise Distributors');
  expect(ragText).not.toContain('Secret Beta Customer');

  // Duplicate webhook retry with exact same update_id is idempotent
  const countBeforeDup = sent.length;
  const dupRes = await request(app)
    .post('/api/webhooks/telegram')
    .set('X-Telegram-Bot-Api-Secret-Token', getTelegramWebhookSecret())
    .send({
      update_id: updateSeq,
      message: {
        message_id: updateSeq,
        from: { id: 7771, first_name: 'Owner', username: 'owner_tg' },
        chat: { id: 7771, type: 'private' },
        date: 1795860000,
        text: 'Which customers are overdue right now?',
      },
    })
    .expect(200);
  expect(dupRes.body.duplicate).toBe(true);
  expect(sent.length).toBe(countBeforeDup);

  // /workspaces and /switch 2 across authorized businesses
  await postWebhook({ chatId: 7771, text: '/workspaces' }).expect(200);
  expect(sent.at(-1).text).toContain('Alpha Packaging');
  expect(sent.at(-1).text).toContain('Alpha Logistics');
  expect(sent.at(-1).text).not.toContain('Beta Steel');

  const sw = await postWebhook({ chatId: 7771, text: '/switch 2' }).expect(200);
  expect(sw.body.handled).toBe('switched');
  expect(sent.at(-1).text).toContain(aliceWs2.name);
});

it('revokes remote Telegram access immediately on password change, /unlink, or account deletion', async () => {
  mockTelegramFetch();
  const owner = await registerUser('Security Owner');
  const ws = await createWorkspace(owner, 'Revoke Check Co');

  const issued = await authed(owner, 'post', `/api/workspaces/${ws.id}/telegram/link-code`, {}).expect(201);
  await postWebhook({ chatId: 7772, text: `/link ${issued.body.code}` }).expect(200);

  // Changing password bumps authVersion -> old Telegram link is immediately invalidated
  const pwdRes = await authed(owner, 'post', '/api/auth/password', { currentPassword: password, newPassword: 'New Password 2026!' }).expect(200);
  owner.csrfToken = pwdRes.body.csrfToken;
  owner.cookie = pwdRes.headers['set-cookie'][0].split(';')[0];
  const afterPwd = await postWebhook({ chatId: 7772, text: 'What is our runway?' }).expect(200);
  expect(afterPwd.body.handled).toBe('unauthorized');

  // Re-link and test /unlink + account deletion cleanup
  const reIssued = await authed(owner, 'post', `/api/workspaces/${ws.id}/telegram/link-code`, {}).expect(201);
  await postWebhook({ chatId: 7772, text: `/link ${reIssued.body.code}` }).expect(200);
  expect(await TelegramLink.countDocuments({ chatId: 7772 })).toBe(1);

  await postWebhook({ chatId: 7772, text: '/unlink' }).expect(200);
  expect(await TelegramLink.countDocuments({ chatId: 7772 })).toBe(0);

  const thirdIssue = await authed(owner, 'post', `/api/workspaces/${ws.id}/telegram/link-code`, {}).expect(201);
  await postWebhook({ chatId: 7772, text: `/link ${thirdIssue.body.code}` }).expect(200);

  await authed(owner, 'delete', '/api/auth/account', { currentPassword: 'New Password 2026!' }).expect(204);
  expect(await TelegramLink.countDocuments({ chatId: 7772 })).toBe(0);
  expect(await TelegramLinkCode.countDocuments({})).toBe(0);
});
