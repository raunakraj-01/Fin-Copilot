import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { dateOnly, itemInput, paise } from '../validators/finance.js';
import CashItem from '../models/CashItem.js';
import RecurringRule from '../models/RecurringRule.js';

const router = Router({ mergeParams: true });
const shape = item => ({ ...item.toObject(), id: String(item._id), outstandingPaise: Math.max(0, item.amountPaise - item.settledPaise) });

router.get('/items', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const query = { workspaceId: req.params.workspaceId };
  if (req.query.category) query.category = validate(z.enum(['receivable', 'payable', 'expense']), req.query.category);
  if (req.query.status) query.status = validate(z.enum(['open', 'partial', 'paid', 'cancelled']), req.query.status);
  const items = await CashItem.find(query).sort({ expectedDate: 1, _id: 1 });
  res.json({ items: items.map(shape) });
}));
router.post('/items', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const item = await CashItem.create({ ...validate(itemInput, req.body), workspaceId: req.params.workspaceId });
  res.status(201).json({ item: shape(item) });
}));
router.patch('/items/:itemId', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.itemId)) fail(404, 'NOT_FOUND', 'Cash item not found');
  const item = await CashItem.findOne({ _id: req.params.itemId, workspaceId: req.params.workspaceId });
  if (!item) fail(404, 'NOT_FOUND', 'Cash item not found');
  const current = item.toObject();
  const editable = ['category', 'externalId', 'counterparty', 'description', 'sourceSystem', 'amountPaise', 'settledPaise', 'status', 'dueDate', 'expectedDate', 'confidenceState', 'constraints'];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([key]) => editable.includes(key)));
  const recordedReceipts = (current.gatewayReceipts || []).reduce((sum, r) => sum + r.amountPaise, 0);
  if (patch.settledPaise != null && patch.settledPaise < recordedReceipts) fail(409, 'CONFLICT', 'Settlement cannot be reduced below confirmed receipts');
  if (recordedReceipts && patch.category && patch.category !== current.category) fail(409, 'CONFLICT', 'A record with confirmed receipts cannot change category');
  if (Object.keys(patch).length !== Object.keys(req.body).length || !Object.keys(patch).length) fail(400, 'VALIDATION_ERROR', 'Invalid item fields');
  const merged = { ...Object.fromEntries(editable.filter(key => current[key] !== undefined).map(key => [key, current[key]])), ...patch,
    constraints: { ...(current.constraints || {}), ...(patch.constraints || {}) } };
  Object.assign(item, validate(itemInput, merged));
  await item.save();
  res.json({ item: shape(item) });
}));
router.delete('/items/:itemId', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.itemId)) fail(404, 'NOT_FOUND', 'Cash item not found');
  const current = await CashItem.findOne({ _id: req.params.itemId, workspaceId: req.params.workspaceId }).lean();
  if (current?.gatewayReceipts?.length) fail(409, 'CONFLICT', 'A record with confirmed receipts cannot be deleted');
  const deleted = await CashItem.findOneAndDelete({ _id: req.params.itemId, workspaceId: req.params.workspaceId, 'gatewayReceipts.0': { $exists: false } });
  if (!deleted) fail(404, 'NOT_FOUND', 'Cash item not found');
  res.status(204).end();
}));

const recurringInput = z.object({ description: z.string().trim().min(1).max(200), amountPaise: paise.positive(),
  dayOfMonth: z.number().int().min(1).max(28), startsOn: dateOnly, endsOn: dateOnly.nullable().optional(),
  mandatory: z.boolean().default(true), active: z.boolean().default(true) }).strict();
router.get('/recurring-rules', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  res.json({ recurringRules: await RecurringRule.find({ workspaceId: req.params.workspaceId }) });
}));
router.post('/recurring-rules', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const data = validate(recurringInput, req.body);
  if (data.endsOn && data.endsOn < data.startsOn) fail(400, 'VALIDATION_ERROR', 'endsOn must be after startsOn');
  const rule = await RecurringRule.create({ ...data, workspaceId: req.params.workspaceId });
  res.status(201).json({ recurringRule: rule });
}));

export default router;
