import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import Workspace from '../models/Workspace.js';
import CashItem from '../models/CashItem.js';
import { parseUpload, suggestMapping } from '../services/imports/parse.js';
import { normalizeRows } from '../services/imports/normalize.js';

const workspaceId = new mongoose.Types.ObjectId('650000000000000000000001');
const fixturePath = name => fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

try {
  await connectDb(process.env.MONGODB_URI);
  await Workspace.updateOne({ _id: workspaceId }, { $setOnInsert: { name: 'Demo Packaging Supplier',
    asOfDate: '2026-11-01', openingCashPaise: 20_000_000, minimumReservePaise: 0 } }, { upsert: true });
  for (const [name, kind] of [['receivables.csv', 'receivables'], ['payables.csv', 'payables']]) {
    const parsed = await parseUpload({ originalname: name, buffer: await readFile(fixturePath(name)) });
    const rows = normalizeRows(parsed.rawRows, suggestMapping(parsed.headers), kind, 'csv');
    if (rows.some(row => row.state !== 'accepted')) throw new Error(`Fixture ${name} has invalid rows`);
    for (const { item } of rows) {
      await CashItem.updateOne({ workspaceId, category: item.category, sourceSystem: item.sourceSystem, externalId: item.externalId },
        { $setOnInsert: { ...item, workspaceId } }, { upsert: true });
    }
  }
  console.log(`Seeded synthetic workspace ${workspaceId}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
