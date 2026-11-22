import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { dateOnly, paise } from '../validators/finance.js';
import Workspace from '../models/Workspace.js';
import PaymentObservation from '../models/PaymentObservation.js';
import { calendarDays, pseudonym, reliability } from '../services/finance/reliability.js';
import { requireOwner } from '../middleware/auth.js';
import CashItem from '../models/CashItem.js';
import { paymentTimingSuggestion } from '../services/finance/paymentTiming.js';

const router = Router({ mergeParams: true });
const gstin = z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/);
const input = z.object({ buyerGstin: gstin, sourceId: z.string().min(1).max(150), invoiceDate: dateOnly,
  dueDate: dateOnly, clearedDate: dateOnly, amountPaise: paise.positive(), source: z.enum(['tally_verified', 'bank_verified', 'gateway_verified']) }).strict();
router.patch('/consent', asyncRoute(async (req, res) => {
  requireOwner(req);
  if (!process.env.TELEMETRY_HMAC_KEY) fail(503, 'UNAVAILABLE', 'Telemetry is disabled');
  const workspace = await workspaceOr404(req.params.workspaceId);
  const { share } = validate(z.object({ share: z.boolean() }).strict(), req.body);
  workspace.sharePaymentTelemetry = share;
  await workspace.save();
  if (!share) await PaymentObservation.deleteMany({ workspaceId: workspace._id });
  res.json({ share });
}));
router.get('/consent', asyncRoute(async (req, res) => {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  res.json({ share: workspace.sharePaymentTelemetry === true });
}));
router.post('/observations', asyncRoute(async (req, res) => {
  if (!process.env.TELEMETRY_HMAC_KEY || req.service?.kind !== 'sync') fail(401, 'UNAUTHORIZED', 'Business-scoped sync credential required');
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
  requireOwner(req);
  if (!process.env.TELEMETRY_HMAC_KEY) fail(503, 'UNAVAILABLE', 'Telemetry is disabled');
  await workspaceOr404(req.params.workspaceId);
  const buyer = validate(gstin, req.params.gstin);
  const since = new Date(); since.setUTCFullYear(since.getUTCFullYear() - 1);
  const observations = await PaymentObservation.find({ workspaceId: req.params.workspaceId, buyerHash: pseudonym(buyer), clearedDate: { $gte: since.toISOString().slice(0, 10) } }).lean();
  const result = reliability(observations);
  res.json(result ? { available: true, ...result } : { available: false, reason: 'Insufficient independent suppliers' });
}));
router.get('/payment-timing/:cashItemId', asyncRoute(async (req, res) => {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  if (!/^[a-f\d]{24}$/i.test(req.params.cashItemId)) fail(404, 'NOT_FOUND', 'Cash record not found');
  const item = await CashItem.findOne({ _id: req.params.cashItemId, workspaceId: workspace._id, category: 'receivable', status: { $in: ['open', 'partial'] } }).lean();
  if (!item) fail(404, 'NOT_FOUND', 'Open customer invoice not found');
  if (item.confidenceState === 'needs_review') fail(409, 'NEEDS_REVIEW', 'Verify this invoice before requesting a timing suggestion');
  const history = await CashItem.find({ workspaceId: workspace._id, category: 'receivable', status: 'paid' }).select('counterparty category status settlementEvents').lean();
  res.json(paymentTimingSuggestion(item, history, 3, workspace.asOfDate));
}));
router.post('/payment-timing/:cashItemId/apply', asyncRoute(async (req, res) => {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  const { confirm, expectedDate } = validate(z.object({ confirm: z.literal(true), expectedDate: dateOnly }).strict(), req.body);
  const item = await CashItem.findOne({ _id: req.params.cashItemId, workspaceId: workspace._id, category: 'receivable', status: { $in: ['open', 'partial'] } });
  if (!item) fail(404, 'NOT_FOUND', 'Open customer invoice not found');
  const history = await CashItem.find({ workspaceId: workspace._id, category: 'receivable', status: 'paid' }).select('counterparty category status settlementEvents').lean();
  const suggestion = paymentTimingSuggestion(item.toObject(), history, 3, workspace.asOfDate);
  if (!suggestion.available || suggestion.expectedDate !== expectedDate) fail(409, 'CONFLICT', 'The payment timing suggestion changed. Review the current evidence again.');
  const updated = await CashItem.findOneAndUpdate({ _id: item._id, workspaceId: workspace._id, __v: item.__v },
    { $set: { expectedDate, confidenceState: 'owner_assumption' }, $inc: { __v: 1 } }, { new: true, runValidators: true });
  if (!updated) fail(409, 'CONFLICT', 'Invoice changed. Refresh before applying the suggestion.');
  res.json({ applied: true, expectedDate: updated.expectedDate, confidenceState: updated.confidenceState, evidenceCount: suggestion.evidenceCount });
}));
export default router;
