import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { dateOnly, itemInput, paise } from '../validators/finance.js';
import CashItem from '../models/CashItem.js';
import PaymentObservation from '../models/PaymentObservation.js';
import SyncBatch from '../models/SyncBatch.js';
import SyncDevice from '../models/SyncDevice.js';
import SyncRun from '../models/SyncRun.js';
import SyncConflict from '../models/SyncConflict.js';
import { calendarDays, pseudonym } from '../services/finance/reliability.js';
import { requireOwner } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
const gstin = z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/);
const observation = z.object({ buyerGstin: gstin, invoiceDate: dateOnly, dueDate: dateOnly,
  clearedDate: dateOnly, amountPaise: paise.positive() }).strict();
const row = z.object({ sourceId: z.string().min(1).max(150), version: z.string().min(1).max(150),
  deleted: z.boolean().default(false), item: itemInput.optional(), observation: observation.optional(),
  paymentEvidence: z.object({ clearedDate: dateOnly, amountPaise: paise.positive() }).strict().optional() }).strict()
  .refine(value => value.deleted || value.item, 'Item required')
  .refine(value => !value.observation || (!value.deleted && value.item?.confidenceState === 'verified' && value.item.status === 'paid'
    && value.item.settledPaise === value.item.amountPaise && value.observation.amountPaise === value.item.amountPaise),
  'Payment observations require a matching fully paid item')
  .refine(value => !value.paymentEvidence || (!value.deleted && value.item?.confidenceState === 'verified' && value.item.status === 'paid'
    && value.item.settledPaise === value.item.amountPaise && value.paymentEvidence.amountPaise === value.item.amountPaise),
  'Payment evidence requires a matching fully paid item');
const batch = z.object({ companyId: z.string().min(1).max(150), batchId: z.string().uuid(), rows: z.array(row).min(1).max(500) }).strict();
const tokenHash = token => createHash('sha256').update(token).digest('hex');

async function authenticateDevice(req) {
  const device = req.service && await SyncDevice.findOne({ _id: req.service._id, workspaceId: req.params.workspaceId, revokedAt: null, kind: 'sync' });
  if (!device) fail(401, 'UNAUTHORIZED', 'Sync device authentication required');
  return device;
}

router.post('/devices', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  const { name, kind } = validate(z.object({ name: z.string().trim().min(1).max(100), kind: z.enum(['sync', 'automation']).default('sync') }).strict(), req.body);
  const token = `hsb_${kind}_${randomBytes(32).toString('base64url')}`;
  const device = await SyncDevice.create({ workspaceId: req.params.workspaceId, name,
    kind, tokenHash: tokenHash(token), tokenPrefix: token.slice(0, 17) });
  res.status(201).json({ device: { id: String(device._id), name: device.name, tokenPrefix: device.tokenPrefix,
    createdAt: device.createdAt }, token });
}));

router.get('/devices', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  const devices = await SyncDevice.find({ workspaceId: req.params.workspaceId }).sort({ createdAt: -1 }).lean();
  res.json({ devices: devices.map(device => ({ id: String(device._id), name: device.name, kind: device.kind,
    tokenPrefix: device.tokenPrefix, revokedAt: device.revokedAt, lastSeenAt: device.lastSeenAt, createdAt: device.createdAt })) });
}));

router.delete('/devices/:deviceId', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  const device = await SyncDevice.findOne({ _id: req.params.deviceId, workspaceId: req.params.workspaceId });
  if (!device) fail(404, 'NOT_FOUND', 'Sync device not found');
  device.revokedAt = new Date();
  await device.save();
  res.status(204).end();
}));

router.post('/batches', asyncRoute(async (req, res) => {
  const device = await authenticateDevice(req);
  await workspaceOr404(req.params.workspaceId);
  const input = validate(batch, req.body);
  const key = { workspaceId: req.params.workspaceId, companyId: input.companyId, batchId: input.batchId };
  if (await SyncBatch.exists(key)) return res.json({ alreadyApplied: true, count: input.rows.length });
  if (new Set(input.rows.map(row => row.sourceId)).size !== input.rows.length) fail(400, 'VALIDATION_ERROR', 'Duplicate source ID in batch');
  const observations = input.rows.filter(row => row.observation);
  if (observations.length) {
    const workspace = await workspaceOr404(req.params.workspaceId);
    if (!workspace.sharePaymentTelemetry) fail(403, 'FORBIDDEN', 'Enable payment telemetry consent before syncing observations');
    if (!process.env.TELEMETRY_HMAC_KEY) fail(503, 'UNAVAILABLE', 'Telemetry is disabled');
    for (const { observation: value } of observations) {
      if (calendarDays(value.clearedDate, value.invoiceDate) < 0 || calendarDays(value.dueDate, value.invoiceDate) < 0)
        fail(400, 'VALIDATION_ERROR', 'Invalid payment chronology');
    }
  }
  const workspace = await workspaceOr404(req.params.workspaceId);
  for (const row of input.rows) {
    const source = { workspaceId: req.params.workspaceId, tallyCompanyId: input.companyId, tallySourceId: row.sourceId };
    const existing = await CashItem.findOne(source);
    if (row.deleted) {
      if (existing && existing.status !== 'cancelled') await SyncConflict.updateOne({ workspaceId: workspace._id, companyId: input.companyId,
        sourceId: row.sourceId, version: row.version }, { $setOnInsert: { workspaceId: workspace._id, companyId: input.companyId,
        sourceId: row.sourceId, version: row.version, batchId: input.batchId, cashItemId: existing._id, kind: 'deleted', before: existing.toObject(), state: 'pending' } }, { upsert: true });
      continue;
    }
    if (existing?.tallyVersion !== row.version) {
      if (row.item.sourceSystem !== 'tally_export') fail(400, 'VALIDATION_ERROR', 'Tally source required');
      const item = { ...row.item, ...source, tallyVersion: row.version, externalId: `${input.companyId}:${row.sourceId}` };
      const changedFields = existing && ['category', 'counterparty', 'amountPaise', 'settledPaise', 'status', 'dueDate', 'expectedDate']
        .filter(key => (existing[key] ?? null) !== (item[key] ?? null));
      const backdated = !existing && [item.dueDate, item.expectedDate].some(date => date && date < workspace.asOfDate);
      if (existing && changedFields.length) {
        await SyncConflict.updateOne({ workspaceId: workspace._id, companyId: input.companyId, sourceId: row.sourceId, version: row.version },
          { $setOnInsert: { workspaceId: workspace._id, companyId: input.companyId, sourceId: row.sourceId, version: row.version,
            batchId: input.batchId, cashItemId: existing._id, kind: 'changed', before: existing.toObject(), proposedItem: item, state: 'pending' } }, { upsert: true });
        continue;
      }
      if (backdated) {
        await SyncConflict.updateOne({ workspaceId: workspace._id, companyId: input.companyId, sourceId: row.sourceId, version: row.version },
          { $setOnInsert: { workspaceId: workspace._id, companyId: input.companyId, sourceId: row.sourceId, version: row.version,
            batchId: input.batchId, kind: 'backdated', proposedItem: item, state: 'pending' } }, { upsert: true });
        continue;
      }
      const evidenceId = `${input.companyId}:${row.sourceId}:${row.paymentEvidence?.clearedDate || ''}`;
      const settlementEvents = row.paymentEvidence ? [{ source: 'tally', sourceId: evidenceId, direction: 'receipt',
        amountPaise: row.paymentEvidence.amountPaise, date: row.paymentEvidence.clearedDate, dueDate: row.item.dueDate,
        completedInvoice: true, verified: true, reference: row.item.externalId || row.sourceId }] : undefined;
      if (existing) {
        if ((existing.gatewayReceipts?.length || existing.settlementEvents?.length) && (item.settledPaise < existing.settledPaise || item.category !== existing.category))
          fail(409, 'CONFLICT', 'Sync would undo confirmed receipts. Review the source settlement before retrying.');
        Object.assign(existing, item);
        if (settlementEvents && !existing.settlementEvents.some(event => event.sourceId === evidenceId)) existing.settlementEvents.push(...settlementEvents);
        await existing.save();
      }
      else await CashItem.create({ ...item, ...(settlementEvents ? { settlementEvents } : {}) });
    }
    if (row.paymentEvidence) {
      const evidenceId = `${input.companyId}:${row.sourceId}:${row.paymentEvidence.clearedDate}`;
      await CashItem.updateOne({ ...source, 'settlementEvents.sourceId': { $ne: evidenceId } }, { $push: { settlementEvents: {
        source: 'tally', sourceId: evidenceId, direction: 'receipt', amountPaise: row.paymentEvidence.amountPaise,
        date: row.paymentEvidence.clearedDate, dueDate: row.item.dueDate, completedInvoice: true, verified: true,
        reference: row.item.externalId || row.sourceId,
      } } });
    }
    if (row.observation) {
      const { buyerGstin, ...value } = row.observation;
      await PaymentObservation.updateOne({ workspaceId: req.params.workspaceId, sourceId: `${input.companyId}:${row.sourceId}` },
        { $set: { ...value, workspaceId: req.params.workspaceId, sourceId: `${input.companyId}:${row.sourceId}`,
          buyerHash: pseudonym(buyerGstin), supplierHash: pseudonym(req.params.workspaceId), source: 'tally_verified' } }, { upsert: true });
    }
  }
  await SyncBatch.create({ ...key, count: input.rows.length, observationCount: observations.length, deviceId: device?._id || null });
  if (device) { device.lastSeenAt = new Date(); device.lastSuccessfulAt = new Date(); await device.save(); }
  res.json({ alreadyApplied: false, count: input.rows.length, observationCount: observations.length });
}));
const runInput = z.object({ runId: z.string().uuid(), companyId: z.string().min(1).max(150), status: z.enum(['running', 'succeeded', 'failed']),
  startedAt: z.coerce.date().optional(), completedAt: z.coerce.date().nullable().optional(), pendingCount: z.number().int().min(0).max(100000).default(0),
  appliedCount: z.number().int().min(0).max(100000).default(0), errorCode: z.string().trim().max(80).default(''),
  errorMessage: z.string().trim().max(500).default('') }).strict();
router.post('/runs', asyncRoute(async (req, res) => {
  const device = await authenticateDevice(req);
  const input = validate(runInput, req.body);
  if (input.status === 'failed' && !input.errorMessage) fail(400, 'VALIDATION_ERROR', 'Failed sync runs need an actionable error message');
  const now = new Date();
  const update = { ...input, workspaceId: req.params.workspaceId, deviceId: device._id, startedAt: input.startedAt || now,
    ...(input.status !== 'running' ? { completedAt: input.completedAt || now } : {}),
    ...(input.status !== 'failed' ? { errorCode: '', errorMessage: '' } : {}) };
  const run = await SyncRun.findOneAndUpdate({ workspaceId: req.params.workspaceId, deviceId: device._id, runId: input.runId },
    { $set: update }, { upsert: true, new: true, runValidators: true });
  device.lastSeenAt = now;
  if (input.status === 'succeeded') device.lastSuccessfulAt = now;
  await device.save();
  res.status(202).json({ recorded: true, runId: run.runId, status: run.status });
}));
router.get('/changes', asyncRoute(async (req, res) => {
  requireOwner(req); await workspaceOr404(req.params.workspaceId);
  const changes = await SyncConflict.find({ workspaceId: req.params.workspaceId, state: 'pending' }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ changes: changes.map(change => ({ id: String(change._id), companyId: change.companyId, sourceId: change.sourceId,
    version: change.version, kind: change.kind, before: change.before, proposedItem: change.proposedItem, createdAt: change.createdAt })) });
}));
router.post('/changes/:changeId/resolve', asyncRoute(async (req, res) => {
  requireOwner(req); const workspace = await workspaceOr404(req.params.workspaceId);
  const decision = validate(z.object({ decision: z.enum(['accept', 'keep_current']) }).strict(), req.body);
  const change = await SyncConflict.findOne({ _id: req.params.changeId, workspaceId: workspace._id, state: 'pending' });
  if (!change) fail(404, 'NOT_FOUND', 'Pending sync change not found');
  if (decision.decision === 'accept') {
    if (change.kind === 'deleted') {
      const existing = change.cashItemId ? await CashItem.findOne({ _id: change.cashItemId, workspaceId: workspace._id }) : null;
      if (existing?.gatewayReceipts?.length || existing?.settlementEvents?.length)
        fail(409, 'CONFLICT', 'This record has confirmed cash settlements. Keep it in the ledger and resolve the Tally deletion separately.');
      if (change.cashItemId) await CashItem.updateOne({ _id: change.cashItemId, workspaceId: workspace._id }, { $set: { status: 'cancelled', tallyVersion: change.version } });
    } else if (change.proposedItem) {
      const current = change.cashItemId ? await CashItem.findOne({ _id: change.cashItemId, workspaceId: workspace._id }) : null;
      if (current) {
        if ((current.gatewayReceipts?.length || current.settlementEvents?.length) && (change.proposedItem.settledPaise < current.settledPaise || change.proposedItem.category !== current.category))
          fail(409, 'CONFLICT', 'This change would undo a confirmed receipt or payment. Resolve the settlement first.');
        Object.assign(current, change.proposedItem, { tallyVersion: change.version }); await current.save();
      } else await CashItem.create({ ...change.proposedItem, workspaceId: workspace._id, tallyCompanyId: change.companyId,
        tallySourceId: change.sourceId, tallyVersion: change.version });
    }
  } else if (change.cashItemId) {
    await CashItem.updateOne({ _id: change.cashItemId, workspaceId: workspace._id }, { $set: { tallyVersion: change.version } });
  }
  change.state = decision.decision === 'accept' ? 'accepted' : 'kept_current'; change.resolvedAt = new Date(); change.resolvedBy = req.user._id; await change.save();
  res.json({ resolved: true, state: change.state });
}));
router.get('/status', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  const [latest, latestRun, lastSuccessful, pendingChanges] = await Promise.all([
    SyncBatch.findOne({ workspaceId: req.params.workspaceId }).sort({ createdAt: -1 }).lean(),
    SyncRun.findOne({ workspaceId: req.params.workspaceId }).sort({ updatedAt: -1, _id: -1 }).lean(),
    SyncRun.findOne({ workspaceId: req.params.workspaceId, status: 'succeeded' }).sort({ completedAt: -1 }).lean(),
    SyncConflict.countDocuments({ workspaceId: req.params.workspaceId, state: 'pending' }),
  ]);
  res.json({ latest, latestRun, lastSuccessfulAt: latestRun?.deviceId ? (await SyncDevice.findById(latestRun.deviceId).select('lastSuccessfulAt').lean())?.lastSuccessfulAt || lastSuccessful?.completedAt || null : lastSuccessful?.completedAt || null,
    pendingChanges, actionableError: latestRun?.status === 'failed' ? { code: latestRun.errorCode, message: latestRun.errorMessage, at: latestRun.completedAt } : null });
}));
export default router;
