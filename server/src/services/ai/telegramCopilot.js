/**
 * Multi-Tenant 2-Way Telegram Fin-RAG Assistant
 * Supports zero-cost webhook transport in production (Render Free Tier compatible,
 * wakes container on demand) with automatic long-polling fallback in local dev.
 * Users self-link via single-use SHA-256 OTP deep links scoped to live RBAC
 * workspace membership and User.authVersion.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import Workspace from '../../models/Workspace.js';
import User from '../../models/User.js';
import TelegramLink from '../../models/TelegramLink.js';
import TelegramLinkCode from '../../models/TelegramLinkCode.js';
import { tokenHash, clientOrigin } from '../auth.js';
import { appendSecurityEvent } from '../audit.js';
import { answerChat } from './copilot.js';

const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const SEEN_UPDATE_TTL_MS = 10 * 60 * 1000;
const MAX_SEEN_UPDATES = 5000;
const CHAT_RATE_WINDOW_MS = 60 * 1000;
const CHAT_RATE_MAX = 15;
const BOT_CACHE_TTL_MS = 60 * 60 * 1000;

let isPolling = false;
let shouldStop = false;
let botCache = { token: '', username: '', fetchedAt: 0 };

const seenUpdates = new Map();
const chatRateWindows = new Map();

export function resetTelegramRuntimeState() {
  seenUpdates.clear();
  chatRateWindows.clear();
  botCache = { token: '', username: '', fetchedAt: 0 };
  isPolling = false;
  shouldStop = true;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getTelegramWebhookSecret(token = process.env.TELEGRAM_BOT_TOKEN) {
  if (process.env.TELEGRAM_WEBHOOK_SECRET) {
    return process.env.TELEGRAM_WEBHOOK_SECRET.trim();
  }
  if (!token) return '';
  return createHmac('sha256', token)
    .update('cashflow-telegram-webhook-secret-v1')
    .digest('hex')
    .slice(0, 64);
}

export function verifyTelegramSecretHeader(suppliedSecret, token = process.env.TELEGRAM_BOT_TOKEN) {
  const expected = getTelegramWebhookSecret(token);
  const supplied = String(suppliedSecret || '').trim();
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function resolveTelegramWebhookUrl() {
  const explicit = (process.env.TELEGRAM_WEBHOOK_URL || '').trim();
  if (explicit) {
    return /^https:\/\//i.test(explicit) ? explicit.replace(/\/$/, '') : '';
  }
  const base = (process.env.CLIENT_ORIGIN || process.env.RENDER_EXTERNAL_URL || clientOrigin() || '').trim();
  if (!/^https:\/\//i.test(base)) return '';
  return `${base.replace(/\/$/, '')}/api/webhooks/telegram`;
}

function getLegacyAllowedChatIds() {
  return (process.env.TELEGRAM_ALLOWED_CHAT_ID || '')
    .split(',')
    .map(id => Number(id.trim()))
    .filter(id => Number.isFinite(id) && id !== 0);
}

function markSeenUpdate(updateId) {
  if (updateId == null) return false;
  const now = Date.now();
  for (const [id, ts] of seenUpdates) {
    if (now - ts > SEEN_UPDATE_TTL_MS) seenUpdates.delete(id);
  }
  if (seenUpdates.has(updateId)) return true;
  if (seenUpdates.size >= MAX_SEEN_UPDATES) {
    const oldest = seenUpdates.keys().next().value;
    if (oldest !== undefined) seenUpdates.delete(oldest);
  }
  seenUpdates.set(updateId, now);
  return false;
}

function checkChatRateLimit(chatId) {
  const now = Date.now();
  const prev = (chatRateWindows.get(chatId) || []).filter(ts => now - ts < CHAT_RATE_WINDOW_MS);
  if (prev.length >= CHAT_RATE_MAX) {
    chatRateWindows.set(chatId, prev);
    return false;
  }
  prev.push(now);
  chatRateWindows.set(chatId, prev);
  return true;
}

export async function getTelegramBotInfo() {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return { configured: false, username: '' };

  const envUsername = (process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '');
  if (envUsername) {
    return { configured: true, username: envUsername };
  }

  if (botCache.token === token && botCache.username && Date.now() - botCache.fetchedAt < BOT_CACHE_TTL_MS) {
    return { configured: true, username: botCache.username };
  }

  if (process.env.VITEST) {
    return { configured: true, username: '' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const username = String(data?.result?.username || '').replace(/^@/, '');
      if (username) {
        botCache = { token, username, fetchedAt: Date.now() };
      }
      return { configured: true, username };
    }
  } catch {
    // Non-fatal: manual /link <code> works even without bot username lookup.
  }
  return { configured: true, username: '' };
}

export async function issueTelegramLinkCode({ userId, workspaceId }) {
  await TelegramLinkCode.init();
  const code = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);

  // Cap active unused codes per user at 5 to avoid accumulation
  const existingCount = await TelegramLinkCode.countDocuments({ userId });
  if (existingCount >= 5) {
    await TelegramLinkCode.deleteMany({ userId });
  }

  await TelegramLinkCode.create({
    tokenHash: tokenHash(code),
    userId,
    workspaceId,
    expiresAt,
  });

  const { configured, username } = await getTelegramBotInfo();
  const deepLink = username ? `https://t.me/${username}?start=${code}` : '';

  return {
    code,
    expiresAt,
    botConfigured: configured,
    botUsername: username,
    deepLink,
  };
}

async function sendTelegramMessage(chatId, htmlText, token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token || !chatId || !htmlText) return;

  const MAX_LEN = 3900;
  const chunks = [];
  if (htmlText.length <= MAX_LEN) {
    chunks.push(htmlText);
  } else {
    let remaining = htmlText;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        chunks.push(remaining);
        break;
      }
      let splitIdx = remaining.lastIndexOf('\n', MAX_LEN);
      if (splitIdx < MAX_LEN / 2) splitIdx = MAX_LEN;
      chunks.push(remaining.slice(0, splitIdx).trim());
      remaining = remaining.slice(splitIdx).trim();
    }
  }

  for (const chunk of chunks) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'HTML',
        }),
      });
      if (!res.ok) {
        const plain = chunk.replace(/<[^>]+>/g, '');
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ chat_id: chatId, text: plain }),
        });
      }
    } catch (err) {
      console.error('[TelegramCopilot] Failed to send message chunk:', err.message);
    }
  }
}

async function sendChatAction(chatId, action = 'typing', token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {}
}

async function listUserWorkspaces(userId) {
  return Workspace.find({ $or: [{ ownerUserId: userId }, { 'members.userId': userId }] })
    .sort({ createdAt: 1 })
    .lean();
}

async function resolveSessionForChat(chatId) {
  const link = await TelegramLink.findOne({ chatId }).lean();
  if (link) {
    const user = await User.findById(link.userId).lean();
    if (!user || user.disabled || user.authVersion !== link.authVersion) {
      await TelegramLink.deleteOne({ _id: link._id }).catch(() => {});
      return { status: 'revoked' };
    }

    const workspaces = await listUserWorkspaces(user._id);
    if (workspaces.length === 0) {
      return { status: 'no_workspace', user, link };
    }

    let workspace = workspaces.find(w => String(w._id) === String(link.activeWorkspaceId || ''));
    if (!workspace && link.activeWorkspaceId) {
      return { status: 'workspace_revoked', user, link, workspaces };
    }
    if (!workspace) {
      workspace = workspaces[0];
      await TelegramLink.updateOne({ _id: link._id }, { $set: { activeWorkspaceId: workspace._id } }).catch(() => {});
    }

    await TelegramLink.updateOne({ _id: link._id }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
    return { status: 'ok', mode: 'linked', user, link, workspace, workspaces };
  }

  // Legacy single-tenant env fallback if explicitly allowlisted
  const legacyAllowed = getLegacyAllowedChatIds();
  if (legacyAllowed.includes(Number(chatId))) {
    const pinnedId = process.env.TELEGRAM_WORKSPACE_ID || process.env.MORNING_BRIEF_WORKSPACE_ID;
    if (pinnedId) {
      const ws = await Workspace.findById(pinnedId).lean();
      if (ws) return { status: 'ok', mode: 'legacy', workspace: ws, workspaces: [ws] };
    } else if (process.env.NODE_ENV !== 'production') {
      const count = await Workspace.countDocuments();
      if (count === 1) {
        const ws = await Workspace.findOne().lean();
        if (ws) return { status: 'ok', mode: 'legacy', workspace: ws, workspaces: [ws] };
      }
    }
    return { status: 'no_workspace' };
  }

  return { status: 'unlinked' };
}

function formatRagReply(answer, workspaceName) {
  const body = escapeHtml(answer.reply || 'No answer generated.');
  const parts = [`<b>${escapeHtml(workspaceName || 'Fin-Copilot')}</b>\n\n${body}`];

  if (Array.isArray(answer.sources) && answer.sources.length > 0) {
    const topSources = answer.sources.slice(0, 3).map(src => {
      const title = escapeHtml(src.title || src.kuId);
      const amount = src.amount ? ` · ${escapeHtml(src.amount)}` : '';
      const date = src.date ? ` (${escapeHtml(src.date)})` : '';
      return `• <code>${title}</code>${amount}${date}`;
    });
    parts.push(`\n\n<b>Grounded sources:</b>\n${topSources.join('\n')}`);
  }

  return parts.join('');
}

async function handleLinkCommand(chatId, msg, codeArg, token) {
  const cleanCode = String(codeArg || '').trim().toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(cleanCode)) {
    await sendTelegramMessage(
      chatId,
      '❌ Invalid link format.\nOpen <b>CashFlow Copilot → Setup &amp; Import → Remote Telegram Fin-RAG</b> to generate a fresh link code.',
      token
    );
    return { ok: true, handled: 'invalid_link_code' };
  }

  const record = await TelegramLinkCode.findOneAndDelete({
    tokenHash: tokenHash(cleanCode),
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!record) {
    await sendTelegramMessage(
      chatId,
      '⏳ That link code is invalid, expired, or already used.\nPlease generate a new one inside <b>Setup &amp; Import</b>.',
      token
    );
    return { ok: true, handled: 'expired_link_code' };
  }

  const [user, workspace] = await Promise.all([
    User.findById(record.userId).lean(),
    Workspace.findOne({
      _id: record.workspaceId,
      $or: [{ ownerUserId: record.userId }, { 'members.userId': record.userId }],
    }).lean(),
  ]);

  if (!user || user.disabled || !workspace) {
    await sendTelegramMessage(chatId, '🔒 Account or workspace access is no longer active.', token);
    return { ok: true, handled: 'link_denied' };
  }

  await TelegramLink.findOneAndUpdate(
    { chatId },
    {
      $set: {
        chatId,
        telegramUserId: msg.from?.id ?? null,
        telegramUsername: String(msg.from?.username || '').slice(0, 100),
        firstName: String(msg.from?.first_name || '').slice(0, 100),
        userId: user._id,
        activeWorkspaceId: workspace._id,
        authVersion: user.authVersion || 0,
        linkedAt: new Date(),
        lastActiveAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  await appendSecurityEvent({
    action: 'telegram.linked',
    outcome: 'succeeded',
    actorUserId: user._id,
    workspaceId: workspace._id,
    details: [`chat:${String(chatId).slice(-4)}`],
  });

  await sendTelegramMessage(
    chatId,
    `✅ <b>Connected to ${escapeHtml(workspace.name)}</b> (as ${escapeHtml(user.name)}).\n\n` +
    `Ask any question about your live ledger, receivables, payables, or 90-day cash runway.\n\n` +
    `Commands:\n` +
    `• /workspaces — list your businesses\n` +
    `• /switch 2 — switch active business\n` +
    `• /status — check active business\n` +
    `• /unlink — disconnect Telegram`,
    token
  );

  return { ok: true, handled: 'linked' };
}

export async function handleTelegramUpdate(update, { token = process.env.TELEGRAM_BOT_TOKEN } = {}) {
  if (!update || typeof update !== 'object') return { ok: true, ignored: true };
  if (update.update_id != null && markSeenUpdate(update.update_id)) {
    return { ok: true, duplicate: true };
  }

  const msg = update.message;
  if (!msg || typeof msg.text !== 'string' || !msg.chat?.id) {
    return { ok: true, ignored: true };
  }

  const chatId = Number(msg.chat.id);
  const chatType = msg.chat.type || 'private';
  const rawText = msg.text.trim();

  // Fail closed in group/supergroup/channel chats so private company financials never leak
  if (chatType !== 'private') {
    if (rawText.startsWith('/')) {
      await sendTelegramMessage(
        chatId,
        '🔒 For financial privacy, CashFlow Copilot only responds in a <b>private direct message</b>.',
        token
      );
    }
    return { ok: true, ignored: 'non_private_chat' };
  }

  if (!rawText) return { ok: true, ignored: true };

  // Handle /start <code?> or /link <code>
  const startMatch = rawText.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i);
  if (startMatch) {
    if (startMatch[1]) {
      return handleLinkCommand(chatId, msg, startMatch[1], token);
    }
    const existing = await resolveSessionForChat(chatId);
    if (existing.status === 'ok') {
      await sendTelegramMessage(
        chatId,
        `👋 Hello <b>${escapeHtml(msg.from?.first_name || 'there')}</b>! You are connected to <b>${escapeHtml(existing.workspace.name)}</b>.\n\n` +
        `Ask me about your cash runway, overdue customers, Section 43B(h) bills, or send /workspaces to switch companies.`,
        token
      );
    } else {
      await sendTelegramMessage(
        chatId,
        `👋 Welcome to <b>CashFlow Fin-Copilot</b>!\n\n` +
        `To connect your account securely for free:\n` +
        `1. Sign in to CashFlow Copilot on web or mobile\n` +
        `2. Open <b>Setup &amp; Import → Remote Telegram Fin-RAG</b>\n` +
        `3. Tap <b>Connect Telegram</b> (or send <code>/link YOUR_CODE</code>)`,
        token
      );
    }
    return { ok: true, handled: 'start' };
  }

  const linkMatch = rawText.match(/^\/link(?:@\w+)?(?:\s+(\S+))?$/i);
  if (linkMatch) {
    return handleLinkCommand(chatId, msg, linkMatch[1] || '', token);
  }

  if (/^\/help(?:@\w+)?$/i.test(rawText)) {
    await sendTelegramMessage(
      chatId,
      `<b>CashFlow Fin-Copilot Commands</b>\n` +
      `• Ask any question directly (e.g. <i>"When will we run out of cash?"</i>, <i>"Who owes us money?"</i>)\n` +
      `• /workspaces — list businesses on your account\n` +
      `• /switch &lt;number&gt; — change active business\n` +
      `• /status — view linked workspace status\n` +
      `• /unlink — disconnect this Telegram chat`,
      token
    );
    return { ok: true, handled: 'help' };
  }

  if (/^\/unlink(?:@\w+)?$/i.test(rawText)) {
    const existing = await TelegramLink.findOneAndDelete({ chatId }).lean();
    if (existing) {
      await appendSecurityEvent({
        action: 'telegram.unlinked',
        outcome: 'succeeded',
        actorUserId: existing.userId,
        workspaceId: existing.activeWorkspaceId || null,
        details: [`chat:${String(chatId).slice(-4)}`, 'telegram_cmd'],
      });
      await sendTelegramMessage(chatId, '🔌 Disconnected your Telegram from CashFlow Copilot.', token);
    } else {
      await sendTelegramMessage(chatId, 'Your Telegram chat is not currently linked.', token);
    }
    return { ok: true, handled: 'unlink' };
  }

  // Resolve authenticated session + workspace membership live
  const resolved = await resolveSessionForChat(chatId);
  if (resolved.status === 'unlinked' || resolved.status === 'revoked') {
    await sendTelegramMessage(
      chatId,
      resolved.status === 'revoked'
        ? '🔒 Your link was reset after a password change or revocation. Generate a new link code in <b>Setup &amp; Import</b>.'
        : '🔒 Your Telegram is not linked to a Fin-Copilot account yet.\nOpen <b>Setup &amp; Import → Remote Telegram Fin-RAG</b> to get your 1-click link code.',
      token
    );
    return { ok: true, handled: 'unauthorized' };
  }

  if (resolved.status === 'no_workspace') {
    await sendTelegramMessage(chatId, '⚠️ No business workspace found on your account. Create one in Setup & Import first.', token);
    return { ok: true, handled: 'no_workspace' };
  }

  if (resolved.status === 'workspace_revoked') {
    const options = (resolved.workspaces || [])
      .map((w, idx) => `${idx + 1}. ${escapeHtml(w.name)}`)
      .join('\n');
    await sendTelegramMessage(
      chatId,
      `⚠️ Access to your previous workspace was removed.\n\nSwitch to another business:\n${options}\n\nSend <code>/switch 1</code> to select.`,
      token
    );
    return { ok: true, handled: 'workspace_revoked' };
  }

  if (/^\/workspaces(?:@\w+)?$/i.test(rawText)) {
    const rows = resolved.workspaces.map((w, idx) => {
      const activeTag = String(w._id) === String(resolved.workspace._id) ? ' ✅' : '';
      return `${idx + 1}. <b>${escapeHtml(w.name)}</b>${activeTag}`;
    });
    await sendTelegramMessage(
      chatId,
      `<b>Your Workspaces</b>\n${rows.join('\n')}\n\nSend <code>/switch &lt;number&gt;</code> to switch.`,
      token
    );
    return { ok: true, handled: 'workspaces' };
  }

  const switchMatch = rawText.match(/^\/switch(?:@\w+)?\s+(.+)$/i);
  if (switchMatch) {
    if (resolved.mode !== 'linked') {
      await sendTelegramMessage(chatId, '⚠️ Switching workspaces requires a linked user account (/link).', token);
      return { ok: true, handled: 'switch_denied' };
    }
    const targetArg = switchMatch[1].trim();
    let targetWs = null;
    if (/^\d+$/.test(targetArg)) {
      const idx = Number(targetArg) - 1;
      if (idx >= 0 && idx < resolved.workspaces.length) targetWs = resolved.workspaces[idx];
    } else {
      targetWs = resolved.workspaces.find(w => w.name.toLowerCase() === targetArg.toLowerCase());
    }
    if (!targetWs) {
      await sendTelegramMessage(chatId, '⚠️ Workspace not found in your authorized businesses. Send /workspaces to list.', token);
      return { ok: true, handled: 'switch_not_found' };
    }
    await TelegramLink.updateOne({ _id: resolved.link._id }, { $set: { activeWorkspaceId: targetWs._id } });
    await sendTelegramMessage(chatId, `✅ Active workspace switched to <b>${escapeHtml(targetWs.name)}</b>.`, token);
    return { ok: true, handled: 'switched' };
  }

  if (/^\/status(?:@\w+)?$/i.test(rawText)) {
    const accountLine = resolved.user ? `${escapeHtml(resolved.user.name)} (${escapeHtml(resolved.user.email)})` : 'Workspace link';
    await sendTelegramMessage(
      chatId,
      `<b>Remote Fin-RAG Status</b>\n` +
      `• Account: ${accountLine}\n` +
      `• Business: <b>${escapeHtml(resolved.workspace.name)}</b>\n` +
      `• Snapshot date: ${escapeHtml(resolved.workspace.asOfDate)}`,
      token
    );
    return { ok: true, handled: 'status' };
  }

  // Per-chat rate limit before running RAG / LLM inference
  if (!checkChatRateLimit(chatId)) {
    await sendTelegramMessage(chatId, '⏱️ Too many questions in a minute. Please wait a few seconds and try again.', token);
    return { ok: true, handled: 'rate_limited' };
  }

  const queryText = rawText.replace(/^\/ask(?:@\w+)?\s+/i, '').slice(0, 2000).trim();
  if (!queryText) return { ok: true, ignored: true };

  await sendChatAction(chatId, 'typing', token);

  try {
    const answer = await answerChat(String(resolved.workspace._id), {
      message: queryText,
      sessionId: `telegram:${chatId}`,
    });

    if (!answer) {
      await sendTelegramMessage(chatId, 'Could not retrieve financial records for this workspace.', token);
      return { ok: true, handled: 'empty_answer' };
    }

    await sendTelegramMessage(chatId, formatRagReply(answer, resolved.workspace.name), token);
    return { ok: true, handled: 'answered', workspaceId: String(resolved.workspace._id), mode: answer.mode };
  } catch (err) {
    console.error('[TelegramCopilot] Error answering query:', err);
    await sendTelegramMessage(chatId, '⚠️ Unable to analyze your financial records right now. Please try again shortly.', token);
    return { ok: true, handled: 'error' };
  }
}

async function registerTelegramWebhook(token, webhookUrl) {
  const secretToken = getTelegramWebhookSecret(token);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ['message'],
        drop_pending_updates: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      console.log(`[TelegramCopilot] Webhook registered at ${webhookUrl}`);
    } else {
      console.warn('[TelegramCopilot] Webhook registration failed:', data.description || res.status);
    }
  } catch (err) {
    console.warn('[TelegramCopilot] Webhook registration skipped:', err.message);
  }
}

export async function startTelegramCopilot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return () => {};
  }

  const webhookUrl = resolveTelegramWebhookUrl();
  if (webhookUrl) {
    if (!process.env.VITEST) {
      void registerTelegramWebhook(token, webhookUrl);
    }
    return () => {};
  }

  const allowedChatIds = getLegacyAllowedChatIds();
  const multiTenantPolling = process.env.TELEGRAM_MULTI_TENANT_POLLING === '1';

  if (allowedChatIds.length === 0 && !multiTenantPolling) {
    console.warn('[TelegramCopilot] No HTTPS webhook URL or TELEGRAM_ALLOWED_CHAT_ID configured; listener disabled (fail-closed).');
    return () => {};
  }

  if (isPolling) return () => {};
  isPolling = true;
  shouldStop = false;

  console.log('[TelegramCopilot] Starting 2-Way Telegram AI Assistant long-polling (dev fallback)...');

  let offset = 0;

  (async () => {
    if (process.env.TELEGRAM_DELETE_WEBHOOK === '1') {
      try {
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
          method: 'POST',
          signal: AbortSignal.timeout(4000),
        });
      } catch {}
    }

    while (!shouldStop) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`;
        const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const data = await res.json();
        if (!data.ok || !Array.isArray(data.result)) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        for (const update of data.result) {
          offset = update.update_id + 1;
          await handleTelegramUpdate(update, { token });
        }
      } catch {
        if (!shouldStop) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    isPolling = false;
  })();

  return () => {
    shouldStop = true;
  };
}
