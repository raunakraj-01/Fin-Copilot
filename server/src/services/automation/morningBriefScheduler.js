/**
 * Morning Cash Brief Scheduler
 * Fires once daily at a configurable IST time for every active workspace.
 * Set MORNING_BRIEF_ALLOW_SEND=1 and optionally MORNING_BRIEF_WEBHOOK_URL to enable delivery.
 * Without a webhook URL, the brief is logged to stdout (always).
 * With a webhook URL, the full brief JSON is POSTed to that URL (gated by MORNING_BRIEF_ALLOW_SEND=1).
 */

import Workspace from '../../models/Workspace.js';
import { generateMorningBrief } from './morningBrief.js';

export const morningBriefEnabled = () => process.env.MORNING_BRIEF_ALLOW_SEND === '1';

function currentISTTime() {
  const now = new Date();
  // IST offset: UTC+5:30 = 330 minutes
  const istMs = now.getTime() + (330 * 60 * 1000);
  const ist = new Date(istMs);
  return { hour: ist.getUTCHours(), minute: ist.getUTCMinutes(), date: ist.toISOString().slice(0, 10) };
}

function parseSchedule() {
  const raw = process.env.MORNING_BRIEF_SCHEDULE || '07:00';
  const [hStr, mStr] = raw.split(':');
  const hour = parseInt(hStr, 10);
  const minute = parseInt(mStr || '0', 10);
  return { hour: isNaN(hour) ? 7 : hour, minute: isNaN(minute) ? 0 : minute };
}

export function startMorningBriefScheduler() {
  const lastFired = new Map(); // workspaceId -> lastFiredDate (YYYY-MM-DD)

  const tick = async () => {
    const { hour: targetHour, minute: targetMinute } = parseSchedule();
    const { hour, minute, date } = currentISTTime();

    if (hour !== targetHour || minute !== targetMinute) return;

    let workspaces;
    try {
      const filter = process.env.MORNING_BRIEF_WORKSPACE_ID
        ? { _id: process.env.MORNING_BRIEF_WORKSPACE_ID }
        : {};
      workspaces = await Workspace.find(filter).select('_id').lean();
    } catch (err) {
      console.error('[MorningBrief] Failed to fetch workspaces:', err.message);
      return;
    }

    for (const ws of workspaces) {
      const wsId = ws._id.toString();
      if (lastFired.get(wsId) === date) continue; // already fired today

      lastFired.set(wsId, date);

      let brief;
      try {
        brief = await generateMorningBrief(wsId);
      } catch (err) {
        console.error(`[MorningBrief] Failed to generate brief for workspace ${wsId}:`, err.message);
        continue;
      }

      // Always log
      console.log(`[MorningBrief] ${date} | Workspace ${wsId} | ${brief.workspaceName || wsId}`);
      console.log(brief.whatsappText);

      // Webhook delivery (gated)
      const webhookUrl = process.env.MORNING_BRIEF_WEBHOOK_URL;
      if (morningBriefEnabled() && webhookUrl) {
        const payload = { ...brief, workspaceId: wsId };
        try {
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            console.log(`[MorningBrief] Webhook delivered for workspace ${wsId} — HTTP ${res.status}`);
          } else {
            console.error(`[MorningBrief] Webhook non-OK for workspace ${wsId} — HTTP ${res.status}`);
          }
        } catch (err) {
          console.error(`[MorningBrief] Webhook failed for workspace ${wsId}:`, err.message);
        }
      }
    }
  };

  const timer = setInterval(tick, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
