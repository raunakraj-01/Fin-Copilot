import 'dotenv/config';
import { connectDb } from '../src/config/db.js';
import Workspace from '../src/models/Workspace.js';
import { answerChat } from '../src/services/ai/copilot.js';

async function main() {
  console.log('Connecting to database...');
  await connectDb(process.env.MONGODB_URI);

  const ws = await Workspace.findOne(process.env.MORNING_BRIEF_WORKSPACE_ID ? { _id: process.env.MORNING_BRIEF_WORKSPACE_ID } : {}).lean();
  if (!ws) {
    console.error('No workspace found.');
    process.exit(1);
  }

  console.log(`Workspace: ${ws.name || ws._id}`);
  const question = process.argv[2] || 'Can I afford to spend 2 lakhs next Tuesday? What is my lowest cash balance?';
  console.log(`\nQuestion: "${question}"`);
  console.log('Asking Gemini 2.5 Flash with live MongoDB financial records...\n');

  const answer = await answerChat(ws._id.toString(), {
    message: question,
    sessionId: 'cli-test',
  });

  console.log('--- AI Response ---');
  console.log(answer.reply);
  console.log('-------------------');
  console.log('Mode:', answer.mode);
  if (answer.facts?.length) {
    console.log('Verified Facts:');
    for (const f of answer.facts) console.log(`• ${f.label}: ${f.value}`);
  }

  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Test error:', err);
  try {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
