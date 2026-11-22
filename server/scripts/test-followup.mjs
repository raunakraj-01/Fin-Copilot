import 'dotenv/config';
import { connectDb } from '../src/config/db.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import CollectionFollowUp from '../src/models/CollectionFollowUp.js';
import { runFollowups, eligible } from '../src/services/finance/followups.js';

async function main() {
  console.log('Connecting to database...');
  await connectDb(process.env.MONGODB_URI);

  const filter = process.env.MORNING_BRIEF_WORKSPACE_ID
    ? { _id: process.env.MORNING_BRIEF_WORKSPACE_ID }
    : {};
  const ws = await Workspace.findOne(filter).lean();
  if (!ws) {
    console.error('No matching workspace found.');
    process.exit(1);
  }

  console.log(`Using workspace: ${ws.name || ws._id} (${ws._id})`);

  // Find an eligible open receivable
  const items = await CashItem.find({ workspaceId: ws._id }).lean();
  const receivable = items.find(eligible);
  if (!receivable) {
    console.log('No eligible open receivable found in this workspace to follow up on.');
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Found open receivable: ${receivable.counterparty} | ${receivable.externalId || receivable._id}`);
  console.log(`Outstanding: INR ${(receivable.amountPaise - (receivable.settledPaise || 0)) / 100} | Due: ${receivable.dueDate}`);

  // Create or reset follow-up rule to be due right now
  const rule = await CollectionFollowUp.findOneAndUpdate(
    { workspaceId: ws._id, cashItemId: receivable._id },
    {
      $set: {
        workspaceId: ws._id,
        cashItemId: receivable._id,
        phone: '919876543210',
        mode: 'demo',
        state: 'active',
        nextRunAt: new Date(Date.now() - 1000), // due right now
        cadenceDays: 3,
        maxAttempts: 3,
        lastOutcome: 'Testing dispatch',
      },
      $setOnInsert: { attempts: 0 }
    },
    { upsert: true, new: true }
  );

  console.log(`Follow-up rule ready (ID: ${rule._id}). Running follow-up cycle...`);

  const prevEnv = process.env.FOLLOWUP_ALLOW_SEND;
  process.env.FOLLOWUP_ALLOW_SEND = '1';

  try {
    await runFollowups({ workspaceId: ws._id, ruleId: rule._id, mode: 'demo' });
    console.log('\nSUCCESS: Follow-up cycle executed and dispatched!');
  } finally {
    process.env.FOLLOWUP_ALLOW_SEND = prevEnv;
  }

  const updatedRule = await CollectionFollowUp.findById(rule._id).lean();
  console.log(`Rule status: ${updatedRule.state} | Attempts: ${updatedRule.attempts}/${updatedRule.maxAttempts} | Last outcome: ${updatedRule.lastOutcome}`);

  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Fatal follow-up test error:', err);
  try {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
