import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { dateOnly, itemInput, paise } from '../validators/finance.js';
import CashItem from '../models/CashItem.js';
import PaymentObservation from '../models/PaymentObservation.js';
import SyncBatch from '../models/SyncBatch.js';
import SyncDevice from '../models/SyncDevice.js';
import { calendarDays, pseudonym } from '../services/finance/reliability.js';
import { requireOwner } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
const gstin = z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/);
const observation = z.object({ buyerGstin: gstin, invoiceDate: dateOnly, dueDate: dateOnly,
  clearedDate: dateOnly, amountPaise: paise.positive() }).strict();
const row = z.object({ sourceId: z.string().min(1).max(150), version: z.string().min(1).max(150),
  deleted: z.boolean().default(false), item: itemInput.optional(), observation: observation.optional() }).strict()
  .refine(value => value.deleted || value.item, 'Item required')
  .refine(value => !value.observation || (!value.deleted && value.item?.status === 'paid'
    && value.item.settledPaise === value.item.amountPaise && value.observation.amountPaise === value.item.amountPaise),
  'Payment observations require a matching fully paid item');
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
  for (const row of input.rows) {
    const source = { workspaceId: req.params.workspaceId, tallyCompanyId: input.companyId, tallySourceId: row.sourceId };
    const existing = await CashItem.findOne(source);
    if (row.deleted) {
      if (existing) { existing.status = 'cancelled'; existing.tallyVersion = row.version; await existing.save(); }
      await PaymentObservation.deleteOne({ workspaceId: req.params.workspaceId, sourceId: `${input.companyId}:${row.sourceId}` });
      continue;
    }
    if (existing?.tallyVersion !== row.version) {
      if (row.item.sourceSystem !== 'tally_export') fail(400, 'VALIDATION_ERROR', 'Tally source required');
      const item = { ...row.item, ...source, tallyVersion: row.version, externalId: `${input.companyId}:${row.sourceId}` };
      if (existing) {
        if (existing.gatewayReceipts?.length && (item.settledPaise < existing.settledPaise || item.category !== existing.category))
          fail(409, 'CONFLICT', 'Sync would undo confirmed receipts. Review the source settlement before retrying.');
        Object.assign(existing, item); await existing.save();
      }
      else await CashItem.create(item);
    }
    if (row.observation) {
      const { buyerGstin, ...value } = row.observation;
      await PaymentObservation.updateOne({ workspaceId: req.params.workspaceId, sourceId: `${input.companyId}:${row.sourceId}` },
        { $set: { ...value, workspaceId: req.params.workspaceId, sourceId: `${input.companyId}:${row.sourceId}`,
          buyerHash: pseudonym(buyerGstin), supplierHash: pseudonym(req.params.workspaceId), source: 'tally_verified' } }, { upsert: true });
    }
  }
  await SyncBatch.create({ ...key, count: input.rows.length, observationCount: observations.length, deviceId: device?._id || null });
  if (device) { device.lastSeenAt = new Date(); await device.save(); }
  res.json({ alreadyApplied: false, count: input.rows.length, observationCount: observations.length });
}));
router.get('/status', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  res.json({ latest: await SyncBatch.findOne({ workspaceId: req.params.workspaceId }).sort({ createdAt: -1 }).lean() });
}));
export default router;
