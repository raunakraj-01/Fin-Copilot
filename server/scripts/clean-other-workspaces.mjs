import 'dotenv/config';
import mongoose from 'mongoose';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import RecurringRule from '../src/models/RecurringRule.js';

const KALYANI_ID = new mongoose.Types.ObjectId('650000000000000000000088');

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB.\n');

  // Find all workspaces except Kalyani Industrial Packaging
  const others = await Workspace.find({ _id: { $ne: KALYANI_ID } }).select('_id name').lean();
  console.log(`Found ${others.length} workspace(s) to remove:`);
  for (const w of others) {
    console.log(`  - Deleting "${w.name}" (${w._id})`);
  }

  const otherIds = others.map(w => w._id);

  if (otherIds.length > 0) {
    const cashRes = await CashItem.deleteMany({ workspaceId: { $in: otherIds } });
    const ruleRes = await RecurringRule.deleteMany({ workspaceId: { $in: otherIds } });
    const wsRes = await Workspace.deleteMany({ _id: { $in: otherIds } });

    console.log(`\nCleanup Results:`);
    console.log(`  ✓ ${wsRes.deletedCount} workspace(s) deleted`);
    console.log(`  ✓ ${cashRes.deletedCount} associated cash item(s) cleaned up`);
    console.log(`  ✓ ${ruleRes.deletedCount} recurring rule(s) removed`);
  }

  const remaining = await Workspace.find().lean();
  console.log(`\n========================================`);
  console.log(`Remaining Active Workspace(s): ${remaining.length}`);
  for (const w of remaining) {
    console.log(`👉 "${w.name}" (${w._id})`);
  }
  console.log(`========================================\n`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\nError cleaning workspaces:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
