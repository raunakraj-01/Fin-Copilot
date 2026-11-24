/**
 * test-delay-predictor.mjs
 * Run:  npm --prefix server run test:delay
 *       (or from root)  npm run test:delay
 *
 * Connects to Atlas, runs one full pass of the Payment Delay Updater,
 * and prints before/after expectedDate for every receivable that was updated.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import CashItem from '../src/models/CashItem.js';
import Workspace from '../src/models/Workspace.js';
import { paymentTimingSuggestion } from '../src/services/finance/paymentTiming.js';

const TAG = '[test:delay]';
const MIN_SAMPLES = 2;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');

  console.log(`${TAG} Connecting to MongoDB…`);
  await mongoose.connect(uri);
  console.log(`${TAG} Connected.\n`);

  const workspaces = await Workspace.find({}, '_id asOfDate').lean();
  console.log(`${TAG} Found ${workspaces.length} workspace(s).\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const ws of workspaces) {
    const wsId = ws._id;
    const asOfDate = ws.asOfDate || null;
    const allItems = await CashItem.find({ workspaceId: wsId }).lean();
    const openReceivables = allItems.filter(
      item => item.category === 'receivable' && item.status !== 'paid' && item.status !== 'cancelled'
    );

    if (!openReceivables.length) continue;

    console.log(`─── Workspace ${wsId} (asOfDate: ${asOfDate || 'none'}) — ${openReceivables.length} open receivable(s) ───`);

    for (const item of openReceivables) {
      const result = paymentTimingSuggestion(item, allItems, MIN_SAMPLES, asOfDate);

      if (!result.available) {
        console.log(`  SKIP  "${item.counterparty}" — ${result.reason}`);
        totalSkipped++;
        continue;
      }

      const tag = result.confidence === 'low' ? 'LOW-CONF' : 'UPDATE';
      const suggestedDate = result.expectedDate;
      const currentDate = item.expectedDate || 'unset';

      if (result.confidence === 'low') {
        console.log(`  ${tag}  "${item.counterparty}" — confidence too low (${result.evidenceCount} invoices, spread too wide) — skipping`);
        totalSkipped++;
        continue;
      }

      if (suggestedDate === item.expectedDate) {
        console.log(`  OK    "${item.counterparty}" — already correct (${suggestedDate})`);
        totalSkipped++;
        continue;
      }

      if (asOfDate && suggestedDate <= asOfDate) {
        console.log(`  SKIP  "${item.counterparty}" — suggested date ${suggestedDate} is in the past (asOfDate: ${asOfDate})`);
        totalSkipped++;
        continue;
      }

      // Apply the update
      await CashItem.updateOne({ _id: item._id }, { $set: { expectedDate: suggestedDate } });

      const direction = result.medianDaysLate >= 0 ? 'late' : 'early';
      console.log(
        `  ✓     "${item.counterparty}": ${currentDate} → ${suggestedDate} ` +
        `(median ${Math.abs(result.medianDaysLate)}d ${direction}, ` +
        `${result.evidenceCount} invoices, confidence: ${result.confidence})`
      );
      totalUpdated++;
    }

    console.log('');
  }

  console.log(`${TAG} Done — updated: ${totalUpdated}, skipped: ${totalSkipped}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error(`${TAG} Fatal:`, err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
