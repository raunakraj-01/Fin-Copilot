import 'dotenv/config';
import { connectDb } from '../src/config/db.js';
import Workspace from '../src/models/Workspace.js';
import { generateMorningBrief } from '../src/services/automation/morningBrief.js';

async function main() {
  console.log('Connecting to database...');
  await connectDb(process.env.MONGODB_URI);

  const filter = process.env.MORNING_BRIEF_WORKSPACE_ID
    ? { _id: process.env.MORNING_BRIEF_WORKSPACE_ID }
    : {};
  const workspaces = await Workspace.find(filter).lean();
  if (!workspaces.length) {
    console.log('No matching workspaces found in database.');
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
    process.exit(0);
  }

  const ws = workspaces[0];
  console.log(`Generating Morning Brief for workspace: ${ws.name} (${ws._id})...`);
  const brief = await generateMorningBrief(ws._id.toString());

  console.log('\n--- Generated Brief Text ---');
  console.log(brief.whatsappText);
  console.log('----------------------------\n');

  const webhookUrl = process.env.MORNING_BRIEF_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('MORNING_BRIEF_WEBHOOK_URL is not configured in .env');
    process.exit(0);
  }

  console.log(`Sending payload to webhook: ${webhookUrl}`);
  const payload = { ...brief, workspaceId: ws._id.toString() };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    console.log(`\nWebhook response: HTTP ${res.status} ${res.statusText}`);
    if (res.ok) {
      console.log('SUCCESS! Brief delivered to your webhook and forwarded to Telegram.');
    } else {
      console.error('Webhook returned non-OK status.');
    }
  } catch (err) {
    console.error('Failed to post to webhook:', err.message);
  }

  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Fatal test error:', err);
  try {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
