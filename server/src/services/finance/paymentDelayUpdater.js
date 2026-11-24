/**
 * Payment Delay Updater — Automation #2
 *
 * Runs every PAYMENT_DELAY_UPDATER_INTERVAL_HOURS (default 6h).
 * For every workspace, scans open receivables, calls paymentTimingSuggestion()
 * on each one using the workspace's full history, then writes back a corrected
 * expectedDate when the evidence is strong enough.
 *
 * Rules:
 *  - minimum 2 verified invoices (down from 3) — practical for Indian MSMEs
 *  - only update when confidence is 'medium' or 'high'
 *  - skip if the new date equals the current expectedDate (no-op)
 *  - never set a date in the past relative to workspace.asOfDate
 *  - uses timer.unref() so it never blocks process exit
 */

import CashItem from '../../models/CashItem.js';
import Workspace from '../../models/Workspace.js';
import { paymentTimingSuggestion } from './paymentTiming.js';

const TAG = '[DelayPredictor]';
const DEFAULT_INTERVAL_HOURS = 6;
const MIN_SAMPLES = 2;

async function runOnce() {
  const workspaces = await Workspace.find({}, '_id asOfDate').lean();
  if (!workspaces.length) {
    console.log(`${TAG} No workspaces found — skipping.`);
    return;
  }

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const ws of workspaces) {
    try {
      const wsId = ws._id;
      const asOfDate = ws.asOfDate || null;

      // Fetch all cash items for this workspace in one query
      const allItems = await CashItem.find({ workspaceId: wsId }).lean();

      // Only process open receivables (not paid, not cancelled)
      const openReceivables = allItems.filter(
        item => item.category === 'receivable' && item.status !== 'paid' && item.status !== 'cancelled'
      );

      if (!openReceivables.length) continue;

      for (const item of openReceivables) {
        try {
          const result = paymentTimingSuggestion(item, allItems, MIN_SAMPLES, asOfDate);

          if (!result.available) {
            totalSkipped++;
            continue;
          }

          // Only trust medium / high confidence updates
          if (result.confidence === 'low') {
            totalSkipped++;
            continue;
          }

          const suggestedDate = result.expectedDate;
          const currentDate = item.expectedDate || null;

          // Skip if already correct
          if (suggestedDate === currentDate) {
            totalSkipped++;
            continue;
          }

          // Don't set a date in the past
          if (asOfDate && suggestedDate <= asOfDate) {
            totalSkipped++;
            continue;
          }

          // Write back
          await CashItem.updateOne(
            { _id: item._id },
            { $set: { expectedDate: suggestedDate } }
          );

          const direction = result.medianDaysLate >= 0 ? 'late' : 'early';
          console.log(
            `${TAG} Updated "${item.counterparty}" (ws ${wsId}): ` +
            `${currentDate || 'unset'} → ${suggestedDate} ` +
            `(median ${Math.abs(result.medianDaysLate)}d ${direction}, ` +
            `${result.evidenceCount} invoices, confidence: ${result.confidence})`
          );
          totalUpdated++;
        } catch (itemErr) {
          console.error(`${TAG} Error processing item ${item._id}:`, itemErr.message);
        }
      }
    } catch (wsErr) {
      console.error(`${TAG} Error processing workspace ${ws._id}:`, wsErr.message);
    }
  }

  console.log(`${TAG} Pass complete — updated: ${totalUpdated}, skipped/insufficient: ${totalSkipped}`);
}

export function startPaymentDelayUpdater() {
  const intervalHours = Number(process.env.PAYMENT_DELAY_UPDATER_INTERVAL_HOURS || DEFAULT_INTERVAL_HOURS);
  const intervalMs = intervalHours * 60 * 60 * 1000;

  console.log(`${TAG} Starting — will run every ${intervalHours}h (and once now on startup).`);

  // Run immediately on startup so we don't wait hours for the first pass
  runOnce().catch(err => console.error(`${TAG} Startup pass failed:`, err.message));

  // Schedule recurring runs
  const timer = setInterval(() => {
    runOnce().catch(err => console.error(`${TAG} Scheduled pass failed:`, err.message));
  }, intervalMs);

  // Don't block process exit
  timer.unref();

  return () => {
    clearInterval(timer);
    console.log(`${TAG} Stopped.`);
  };
}
