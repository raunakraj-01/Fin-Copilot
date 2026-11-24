/**
 * Seed Script: Realistic Indian MSME Dataset
 * Workspace: "Kalyani Industrial Packaging (Live Real-World)"
 *
 * Populates real-world receivables, payables, and historical verified
 * settlement events for delay prediction and cashflow stress testing.
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Workspace from '../src/models/Workspace.js';
import CashItem from '../src/models/CashItem.js';
import RecurringRule from '../src/models/RecurringRule.js';
import User from '../src/models/User.js';
import { parseUpload, suggestMapping } from '../src/services/imports/parse.js';
import { normalizeRows } from '../src/services/imports/normalize.js';

const fixturePath = name => fileURLToPath(new URL(`../../fixtures/real-world-msme/${name}`, import.meta.url));

const WORKSPACE_ID = new mongoose.Types.ObjectId('650000000000000000000088');

async function main() {
  console.log('Connecting to MongoDB...');
  await connectDb(process.env.MONGODB_URI);

  const ownerUser = await User.findOne({ email: 'satviktripathi.cs25@rvce.edu.in' }).lean();

  console.log('Setting up Workspace: "Kalyani Industrial Packaging (Live Real-World)"...');
  await Workspace.updateOne(
    { _id: WORKSPACE_ID },
    {
      $set: {
        name: 'Kalyani Industrial Packaging (Live Real-World)',
        asOfDate: '2026-11-01',
        openingCashPaise: 35000000, // ₹3,50,000 liquid bank cash
        minimumReservePaise: 10000000, // ₹1,00,000 target safety reserve
        ...(ownerUser ? { ownerUserId: ownerUser._id } : {}),
      },
    },
    { upsert: true }
  );

  // Clean old items for this workspace to ensure clean state
  await CashItem.deleteMany({ workspaceId: WORKSPACE_ID });
  await RecurringRule.deleteMany({ workspaceId: WORKSPACE_ID });

  console.log('Importing Receivables & Payables fixtures...');
  for (const [name, kind] of [
    ['receivables.csv', 'receivables'],
    ['payables.csv', 'payables'],
  ]) {
    const fileBuf = await readFile(fixturePath(name));
    const parsed = await parseUpload({ originalname: name, buffer: fileBuf });
    const rows = normalizeRows(parsed.rawRows, suggestMapping(parsed.headers), kind, 'csv');

    for (const { item } of rows) {
      await CashItem.create({
        ...item,
        workspaceId: WORKSPACE_ID,
      });
    }
    console.log(`  ✓ Imported ${rows.length} ${kind}`);
  }

  // Inject verified historical settlement events on past paid invoices
  // This enables the Payment Delay Predictor (Automation #2) to train on real patterns
  console.log('Injecting historical verified settlement observations for Delay Predictor...');
  const historicalSettlements = [
    // Varun Beverages Ltd (Consistent ~21 days late)
    { externalId: 'INV/2026/PAID-V01', date: '2026-10-06', dueDate: '2026-09-15', amountPaise: 45000000, reference: 'NEFT-HDFC-VARUN-01' },
    { externalId: 'INV/2026/PAID-V02', date: '2026-09-10', dueDate: '2026-08-20', amountPaise: 38000000, reference: 'NEFT-HDFC-VARUN-02' },
    { externalId: 'INV/2026/PAID-V03', date: '2026-08-05', dueDate: '2026-07-15', amountPaise: 42000000, reference: 'NEFT-HDFC-VARUN-03' },
    { externalId: 'INV/2026/PAID-V04', date: '2026-06-30', dueDate: '2026-06-10', amountPaise: 35000000, reference: 'NEFT-HDFC-VARUN-04' },
    { externalId: 'INV/2026/PAID-V05', date: '2026-06-05', dueDate: '2026-05-15', amountPaise: 49000000, reference: 'NEFT-HDFC-VARUN-05' },
    // Reliance Retail Ltd (Consistent ~32 days late)
    { externalId: 'INV/2026/PAID-R01', date: '2026-10-07', dueDate: '2026-09-05', amountPaise: 52000000, reference: 'RTGS-SBIN-REL-01' },
    { externalId: 'INV/2026/PAID-R02', date: '2026-09-11', dueDate: '2026-08-10', amountPaise: 41000000, reference: 'RTGS-SBIN-REL-02' },
    { externalId: 'INV/2026/PAID-R03', date: '2026-08-06', dueDate: '2026-07-05', amountPaise: 58000000, reference: 'RTGS-SBIN-REL-03' },
    { externalId: 'INV/2026/PAID-R04', date: '2026-07-03', dueDate: '2026-06-01', amountPaise: 46000000, reference: 'RTGS-SBIN-REL-04' },
    { externalId: 'INV/2026/PAID-R05', date: '2026-06-11', dueDate: '2026-05-10', amountPaise: 50000000, reference: 'RTGS-SBIN-REL-05' },
    // Sundaram Fasteners Ltd (Consistent ~6 days late)
    { externalId: 'INV/2026/PAID-S01', date: '2026-09-26', dueDate: '2026-09-20', amountPaise: 25000000, reference: 'NEFT-ICIC-SUNDARAM-01' },
    { externalId: 'INV/2026/PAID-S02', date: '2026-10-11', dueDate: '2026-10-05', amountPaise: 29000000, reference: 'NEFT-ICIC-SUNDARAM-02' },
    { externalId: 'INV/2026/PAID-S03', date: '2026-08-21', dueDate: '2026-08-15', amountPaise: 27000000, reference: 'NEFT-ICIC-SUNDARAM-03' },
    { externalId: 'INV/2026/PAID-S04', date: '2026-07-26', dueDate: '2026-07-20', amountPaise: 31000000, reference: 'NEFT-ICIC-SUNDARAM-04' },
    { externalId: 'INV/2026/PAID-S05', date: '2026-06-21', dueDate: '2026-06-15', amountPaise: 24000000, reference: 'NEFT-ICIC-SUNDARAM-05' },
    // Apex Pharma Chem Pvt Ltd (0 days on-time)
    { externalId: 'INV/2026/PAID-A01', date: '2026-09-10', dueDate: '2026-09-10', amountPaise: 13000000, reference: 'UPI-APEX-PHARMA-01' },
    { externalId: 'INV/2026/PAID-A02', date: '2026-10-12', dueDate: '2026-10-12', amountPaise: 16000000, reference: 'UPI-APEX-PHARMA-02' },
  ];

  for (const s of historicalSettlements) {
    await CashItem.updateOne(
      { workspaceId: WORKSPACE_ID, externalId: s.externalId },
      {
        $set: {
          settlementEvents: [
            {
              source: 'bank',
              sourceId: `BANK-${s.externalId}`,
              direction: 'receipt',
              amountPaise: s.amountPaise,
              date: s.date,
              dueDate: s.dueDate,
              completedInvoice: true,
              verified: true,
              reference: s.reference,
            },
          ],
        },
      }
    );
  }
  console.log(`  ✓ Linked ${historicalSettlements.length} verified settlement history records.`);

  // Setup Recurring Rules for factory monthly obligations
  console.log('Seeding recurring factory expense rules...');
  await RecurringRule.create([
    {
      workspaceId: WORKSPACE_ID,
      description: 'Factory Security & Facility Maintenance',
      amountPaise: 2500000, // ₹25,000
      dayOfMonth: 5,
      startsOn: '2026-11-01',
      mandatory: true,
      active: true,
    },
    {
      workspaceId: WORKSPACE_ID,
      description: 'Leased Line Internet & Cloud Accounting ERP',
      amountPaise: 850000, // ₹8,500
      dayOfMonth: 10,
      startsOn: '2026-11-01',
      mandatory: true,
      active: true,
    },
  ]);
  console.log('  ✓ Seeded recurring monthly overhead rules.');

  console.log('\n======================================================');
  console.log('REAL-WORLD INDIAN MSME DATASET SEEDED SUCCESSFULLY');
  console.log('======================================================');
  console.log(`Workspace ID: ${WORKSPACE_ID}`);
  console.log('Name:         Kalyani Industrial Packaging (Live Real-World)');
  console.log('Opening Cash: ₹3,50,000.00 | Safety Reserve: ₹1,00,000.00');
  console.log('As-Of Date:   2026-11-01');
  console.log('======================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Seeding failed:', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
