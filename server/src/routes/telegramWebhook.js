import { Router } from 'express';
import { asyncRoute, fail } from '../utils/http.js';
import { handleTelegramUpdate, verifyTelegramSecretHeader } from '../services/ai/telegramCopilot.js';

const router = Router();

router.post('/', asyncRoute(async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    fail(503, 'TELEGRAM_NOT_CONFIGURED', 'Telegram bot is not configured');
  }

  const secretHeader = req.get('X-Telegram-Bot-Api-Secret-Token');
  if (!verifyTelegramSecretHeader(secretHeader, token)) {
    fail(401, 'UNAUTHORIZED', 'Invalid Telegram webhook secret token');
  }

  const result = await handleTelegramUpdate(req.body, { token });
  res.status(200).json(result || { ok: true });
}));

export default router;
