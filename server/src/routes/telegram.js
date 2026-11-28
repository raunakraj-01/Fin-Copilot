import { Router } from 'express';
import TelegramLink from '../models/TelegramLink.js';
import { asyncRoute, fail } from '../utils/http.js';
import { rateLimitHeavy } from '../middleware/rateLimit.js';
import { appendSecurityEvent } from '../services/audit.js';
import { getTelegramBotInfo, issueTelegramLinkCode, resolveTelegramWebhookUrl } from '../services/ai/telegramCopilot.js';

const router = Router({ mergeParams: true });
const linkCodeLimiter = rateLimitHeavy({ name: 'telegram_link_code', max: 15, windowMs: 15 * 60_000 });

router.get('/status', asyncRoute(async (req, res) => {
  const [botInfo, link] = await Promise.all([
    getTelegramBotInfo(),
    TelegramLink.findOne({ userId: req.user._id }).lean(),
  ]);
  const webhookUrl = resolveTelegramWebhookUrl();

  res.json({
    botConfigured: botInfo.configured,
    botUsername: botInfo.username,
    transport: webhookUrl ? 'webhook' : 'polling',
    linked: Boolean(link),
    link: link ? {
      telegramUsername: link.telegramUsername || '',
      firstName: link.firstName || '',
      maskedChatId: `•••${String(link.chatId).slice(-4)}`,
      activeWorkspaceMatchesCurrent: String(link.activeWorkspaceId || '') === String(req.params.workspaceId),
      linkedAt: link.linkedAt,
      lastActiveAt: link.lastActiveAt,
    } : null,
  });
}));

router.post('/link-code', linkCodeLimiter, asyncRoute(async (req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    fail(503, 'TELEGRAM_NOT_CONFIGURED', 'Telegram bot token is not configured on the server');
  }
  const issued = await issueTelegramLinkCode({
    userId: req.user._id,
    workspaceId: req.params.workspaceId,
  });
  await appendSecurityEvent({
    action: 'telegram.link_code_issued',
    outcome: 'succeeded',
    actorUserId: req.user._id,
    workspaceId: req.params.workspaceId,
    ip: req.ip,
  });
  res.status(201).json(issued);
}));

router.post('/unlink', asyncRoute(async (req, res) => {
  const deleted = await TelegramLink.findOneAndDelete({ userId: req.user._id }).lean();
  if (deleted) {
    await appendSecurityEvent({
      action: 'telegram.unlinked',
      outcome: 'succeeded',
      actorUserId: req.user._id,
      workspaceId: req.params.workspaceId,
      ip: req.ip,
      details: ['web_ui'],
    });
  }
  res.json({ unlinked: Boolean(deleted) });
}));

export default router;
