import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { dateOnly, paise } from '../validators/finance.js';
import Workspace from '../models/Workspace.js';
import PaymentObservation from '../models/PaymentObservation.js';
import { calendarDays, pseudonym, reliability } from '../services/finance/reliability.js';

const router = Router({ mergeParams: true });
const gstin = z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/);
const input = z.object({ buyerGstin: gstin, sourceId: z.string().min(1).max(150), invoiceDate: dateOnly,
  dueDate: dateOnly, clearedDate: dateOnly, amountPaise: paise.positive(), source: z.enum(['tally_verified', 'bank_verified', 'gateway_verified']) }).strict();
router.patch('/consent', asyncRoute(async (req, res) => {
  if (req.app.locals.demoMode !== true && (!process.env.FEATURE_ADMIN_TOKEN || req.get('Authorization') !== `Bearer ${process.env.FEATURE_ADMIN_TOKEN}`)) fail(401, 'UNAUTHORIZED', 'Owner authorization required');
  if (!process.env.TELEMETRY_HMAC_KEY) fail(503, 'UNAVAILABLE', 'Telemetry is disabled');
  const workspace = await workspaceOr404(req.params.workspaceId);
  const { share } = validate(z.object({ share: z.boolean() }).strict(), req.body);
  workspace.sharePaymentTelemetry = share;
  await workspace.save();
  if (!share) await PaymentObservation.deleteMany({ workspaceId: workspace._id });
  res.json({ share });
}));
router.post('/observations', asyncRoute(async (req, res) => {
  if (!process.env.TELEMETRY_HMAC_KEY || !process.env.OBSERVATION_TOKEN || req.get('Authorization') !== `Bearer ${process.env.OBSERVATION_TOKEN}`) fail(401, 'UNAUTHORIZED', 'Verified source required');
  const workspace = await workspaceOr404(req.params.workspaceId);
  if (!workspace.sharePaymentTelemetry) fail(403, 'FORBIDDEN', 'Telemetry consent required');
  const data = validate(input, req.body);
  if (calendarDays(data.clearedDate, data.invoiceDate) < 0 || calendarDays(data.dueDate, data.invoiceDate) < 0) fail(400, 'VALIDATION_ERROR', 'Invalid payment chronology');
  const { buyerGstin, ...record } = data;
  await PaymentObservation.updateOne({ workspaceId: workspace._id, sourceId: data.sourceId }, { $set: {
    ...record, workspaceId: workspace._id, buyerHash: pseudonym(buyerGstin), supplierHash: pseudonym(String(workspace._id)),
  } }, { upsert: true });
  res.status(202).json({ accepted: true });
}));
router.get('/buyers/:gstin', asyncRoute(async (req, res) => {
  if (req.app.locals.demoMode !== true && (!process.env.FEATURE_ADMIN_TOKEN || req.get('Authorization') !== `Bearer ${process.env.FEATURE_ADMIN_TOKEN}`)) fail(401, 'UNAUTHORIZED', 'Owner authorization required');
  if (!process.env.TELEMETRY_HMAC_KEY) fail(503, 'UNAVAILABLE', 'Telemetry is disabled');
  await workspaceOr404(req.params.workspaceId);
  const buyer = validate(gstin, req.params.gstin);
  const since = new Date(); since.setUTCFullYear(since.getUTCFullYear() - 1);
  const observations = await PaymentObservation.find({ buyerHash: pseudonym(buyer), clearedDate: { $gte: since.toISOString().slice(0, 10) } }).lean();
  const result = reliability(observations);
  res.json(result ? { available: true, ...result } : { available: false, reason: 'Insufficient independent suppliers' });
}));
export default router;
