import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { itemInput } from '../validators/finance.js';
import CashItem from '../models/CashItem.js';
import SyncBatch from '../models/SyncBatch.js';

const router = Router({ mergeParams: true });
const row = z.object({ sourceId: z.string().min(1).max(150), version: z.string().min(1).max(150),
  deleted: z.boolean().default(false), item: itemInput.optional() }).strict().refine(value => value.deleted || value.item, 'Item required');
const batch = z.object({ companyId: z.string().min(1).max(150), batchId: z.string().uuid(), rows: z.array(row).min(1).max(500) }).strict();

router.post('/batches', asyncRoute(async (req, res) => {
  if (!process.env.TALLY_SYNC_TOKEN || !process.env.TALLY_SYNC_WORKSPACE_ID || req.params.workspaceId !== process.env.TALLY_SYNC_WORKSPACE_ID || req.get('Authorization') !== `Bearer ${process.env.TALLY_SYNC_TOKEN}`) fail(401, 'UNAUTHORIZED', 'Sync device authentication required');
  await workspaceOr404(req.params.workspaceId);
  const input = validate(batch, req.body);
  const key = { workspaceId: req.params.workspaceId, companyId: input.companyId, batchId: input.batchId };
  if (await SyncBatch.exists(key)) return res.json({ alreadyApplied: true, count: input.rows.length });
  if (new Set(input.rows.map(row => row.sourceId)).size !== input.rows.length) fail(400, 'VALIDATION_ERROR', 'Duplicate source ID in batch');
  for (const row of input.rows) {
    const source = { workspaceId: req.params.workspaceId, tallyCompanyId: input.companyId, tallySourceId: row.sourceId };
    const existing = await CashItem.findOne(source);
    if (existing?.tallyVersion === row.version) continue;
    if (row.deleted) {
      if (existing) { existing.status = 'cancelled'; existing.tallyVersion = row.version; await existing.save(); }
      continue;
    }
    if (row.item.sourceSystem !== 'tally_export') fail(400, 'VALIDATION_ERROR', 'Tally source required');
    const item = { ...row.item, ...source, tallyVersion: row.version, externalId: `${input.companyId}:${row.sourceId}` };
    if (existing) { Object.assign(existing, item); await existing.save(); }
    else await CashItem.create(item);
  }
  await SyncBatch.create({ ...key, count: input.rows.length });
  res.json({ alreadyApplied: false, count: input.rows.length });
}));
router.get('/status', asyncRoute(async (req, res) => {
  if (req.app.locals.demoMode !== true && (!process.env.FEATURE_ADMIN_TOKEN || req.get('Authorization') !== `Bearer ${process.env.FEATURE_ADMIN_TOKEN}`)) fail(401, 'UNAUTHORIZED', 'Owner authorization required');
  await workspaceOr404(req.params.workspaceId);
  res.json({ latest: await SyncBatch.findOne({ workspaceId: req.params.workspaceId }).sort({ createdAt: -1 }).lean() });
}));
export default router;
