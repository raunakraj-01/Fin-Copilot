/**
 * Autonomous 2-Way Telegram Copilot Assistant
 * Listens for questions from the business owner on Telegram via long-polling,
 * queries live MongoDB financial facts, feeds them to Gemini Generative RAG,
 * and replies directly to Telegram in real time.
 */

import Workspace from '../../models/Workspace.js';
import { answerChat } from './copilot.js';

let isPolling = false;
let shouldStop = false;

export async function startTelegramCopilot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return () => {};
  }

  const rawAllowed = process.env.TELEGRAM_ALLOWED_CHAT_ID || '';
  const allowedChatIds = rawAllowed
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => !isNaN(id) && id !== 0);

  if (isPolling) return () => {};
  isPolling = true;
  shouldStop = false;

  console.log('[TelegramCopilot] Starting 2-Way Telegram AI Assistant listener...');

  let offset = 0;

  async function resolveWorkspaceId() {
    if (process.env.MORNING_BRIEF_WORKSPACE_ID) {
      return process.env.MORNING_BRIEF_WORKSPACE_ID;
    }
    const ws = await Workspace.findOne().sort({ updatedAt: -1 }).lean();
    return ws ? ws._id.toString() : null;
  }

  async function sendTelegramMessage(chatId, text) {
    if (!text) return;

    // Telegram character limit per message is 4096. Split gracefully if needed.
    const MAX_LEN = 3900;
    const chunks = [];
    if (text.length <= MAX_LEN) {
      chunks.push(text);
    } else {
      let remaining = text;
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
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            parse_mode: 'Markdown',
          }),
        });

        if (!res.ok) {
          // If markdown parsing failed (e.g. unclosed asterisk or underscore), fallback to clean text
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk,
            }),
          });
        }
      } catch (err) {
        console.error('[TelegramCopilot] Failed to send message chunk:', err.message);
      }
    }
  }

  async function sendChatAction(chatId, action = 'typing') {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action }),
      });
    } catch {}
  }

  // Background long-polling loop
  (async () => {
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
          const msg = update.message;
          if (!msg || !msg.text) continue;

          const chatId = msg.chat?.id;
          const userText = msg.text.trim();
          const senderName = msg.from?.first_name || 'Owner';

          // Security: restrict to authorized user(s) if configured
          if (allowedChatIds.length > 0 && !allowedChatIds.includes(Number(chatId))) {
            console.warn(`[TelegramCopilot] Access denied for chatId ${chatId} (${senderName})`);
            await sendTelegramMessage(
              chatId,
              `🔒 *Access Denied:* This Fin-Copilot AI instance is private and restricted to verified business users.\n\nYour Chat ID: \`${chatId}\`\n(Share this ID with the owner to request access.)`
            );
            continue;
          }

          if (userText === '/start' || userText === '/help') {
            await sendTelegramMessage(
              chatId,
              `👋 *Hello ${senderName}!* I am your *Fin-Copilot AI Assistant*.\n\n` +
              `Ask me anything about your business finances directly from your live database:\n\n` +
              `• *"Can I afford to spend 2 lakhs next Tuesday?"*\n` +
              `• *"Who owes us the most money right now?"*\n` +
              `• *"What is our lowest cash balance in the next 30 days?"*\n` +
              `• *"What are our Section 43B(h) statutory tax risks?"*\n` +
              `• *"Draft a polite reminder message for Acme Retail."*`
            );
            continue;
          }

          // Show typing indicator
          await sendChatAction(chatId, 'typing');

          const workspaceId = await resolveWorkspaceId();
          if (!workspaceId) {
            await sendTelegramMessage(chatId, '⚠️ No active business workspace found in the database.');
            continue;
          }

          console.log(`[TelegramCopilot] Question from ${senderName}: "${userText}"`);

          try {
            const answer = await answerChat(workspaceId, {
              message: userText,
              sessionId: `telegram:${chatId}`,
            });

            if (!answer) {
              await sendTelegramMessage(chatId, 'Could not retrieve financial data for this workspace.');
              continue;
            }

            const replyBody = answer.reply || 'No answer generated.';
            await sendTelegramMessage(chatId, replyBody);
            console.log(`[TelegramCopilot] Replied to ${senderName}`);
          } catch (err) {
            console.error('[TelegramCopilot] Error answering query:', err.message);
            await sendTelegramMessage(
              chatId,
              `⚠️ Error analyzing financial data: ${err.message}`
            );
          }
        }
      } catch (err) {
        if (!shouldStop) {
          // Temporary network blip or timeout
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
