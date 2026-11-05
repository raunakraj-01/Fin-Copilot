import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import CashItem from '../models/CashItem.js';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { dateOnly, paise } from '../validators/finance.js';
import { currentPromises, promiseState, itemPromiseStates } from '../services/finance/promises.js';

const router = Router({ mergeParams: true });
const note = z.string().trim().max(1000).default('');
const terms = z.object({ amountPaise: paise.positive(), promisedDate: dateOnly, note }).strict();
const receipt = z.object({ amountPaise: paise.positive(), receivedDate: dateOnly, note,
  requestId: z.string().uuid() }).strict();

router.get('/promises', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  const items = await CashItem.find({ workspaceId: workspace._id, category: 'receivable' }).lean();
  res.json({ asOfDate: workspace.asOfDate, items: items.map(item => ({ id: String(item._id),
    counterparty: item.counterparty, externalId: item.externalId, status: item.status,
    outstandingPaise: Math.max(0, item.amountPaise - item.settledPaise), confidenceState: item.confidenceState,
    promises: itemPromiseStates(item, workspace.asOfDate) })) });
}));

async function change(req, res, action) {
  const workspace = await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.itemId)) fail(404, 'NOT_FOUND', 'Invoice not found');
  const item = await CashItem.findOne({ _id: req.params.itemId, workspaceId: workspace._id, category: 'receivable' });
  if (!item) fail(404, 'NOT_FOUND', 'Invoice not found');
  const originalSettled = item.settledPaise;
  const version = item.promiseVersion || 0;
  const data = validate(action === 'cancelled' ? z.object({ note }).strict() : action === 'receipt' ? receipt : terms, req.body);
  const promise = action === 'created' ? null : item.paymentPromises.id(req.params.promiseId);
  if (action !== 'created' && !promise) fail(404, 'NOT_FOUND', 'Promise not found');
  // Receipt retries return the original result without settling twice, even after fulfillment.
  if (action === 'receipt' && item.paymentPromises.some(p => p.history.some(h => h.requestId === data.requestId))) {
    const prior = promise.history.find(h => h.requestId === data.requestId);
    if (!prior || prior.amountPaise !== data.amountPaise || prior.receivedDate !== data.receivedDate)
      fail(409, 'CONFLICT', 'Receipt request ID has already been used with different details');
    return res.json({ itemId: String(item._id), duplicate: true });
  }
  if (!['open', 'partial'].includes(item.status)) fail(409, 'CONFLICT', 'Invoice is paid or cancelled');
  if (promise?.closedAs) fail(409, 'CONFLICT', 'Promise is already closed');
  const history = { action, at: new Date(), asOfDate: workspace.asOfDate, note: data.note,
    ...(promise ? { statusBefore: promiseState(promise.toObject(), workspace.asOfDate).status } : {}) };
  const remaining = promise ? promise.amountPaise - promise.receivedPaise : 0;
  if (promise && remaining <= 0) fail(409, 'CONFLICT', 'Promise is already fulfilled');
  let newReceipt;
  if (action === 'receipt') {
    if (data.amountPaise > remaining || data.amountPaise > item.amountPaise - item.settledPaise)
      fail(400, 'VALIDATION_ERROR', 'Receipt exceeds the unpaid promise or invoice balance');
    history.statusBefore = promiseState(promise.toObject(), data.receivedDate > workspace.asOfDate ? data.receivedDate : workspace.asOfDate).status;
    promise.receivedPaise += data.amountPaise;
    promise.history.push({ ...history, amountPaise: data.amountPaise, receivedDate: data.receivedDate, requestId: data.requestId });
    newReceipt = { paymentOfferId: `promise:${data.requestId}`, amountPaise: data.amountPaise, date: data.receivedDate };
  } else if (action === 'cancelled') {
    promise.closedAs = 'cancelled'; promise.history.push(history);
  } else {
    if (data.promisedDate <= workspace.asOfDate) fail(400, 'VALIDATION_ERROR', 'Promise date must follow the cash snapshot date');
    const reserved = currentPromises(item.toObject(), workspace.asOfDate)
      .filter(p => p.id !== String(promise?._id)).reduce((sum, p) => sum + p.remainingPaise, 0);
    if (data.amountPaise > item.amountPaise - item.settledPaise - reserved)
      fail(400, 'VALIDATION_ERROR', 'Promises cannot exceed the outstanding invoice balance');
    if (item.paymentPromises.length >= 500) fail(400, 'VALIDATION_ERROR', 'Promise history limit reached');
    if (promise) { promise.closedAs = 'superseded'; promise.history.push(history); }
    item.paymentPromises.push({ amountPaise: data.amountPaise, promisedDate: data.promisedDate,
      history: [{ ...history, amountPaise: data.amountPaise, promisedDate: data.promisedDate }] });
  }
  const update = { $set: { paymentPromises: item.paymentPromises.toObject() }, $inc: { promiseVersion: 1, __v: 1 } };
  if (newReceipt) {
    update.$inc.settledPaise = data.amountPaise;
    update.$push = { gatewayReceipts: newReceipt };
    update.$set.status = originalSettled + data.amountPaise === item.amountPaise ? 'paid' : 'partial';
    if (item.constraints?.maxEarlyCollectionPaise != null)
      update.$set['constraints.maxEarlyCollectionPaise'] = Math.min(item.constraints.maxEarlyCollectionPaise, item.amountPaise - originalSettled - data.amountPaise);
  }
  const updated = await CashItem.findOneAndUpdate({ _id: item._id, workspaceId: workspace._id,
    settledPaise: originalSettled, status: item.status, amountPaise: item.amountPaise, category: 'receivable',
    ...(version ? { promiseVersion: version } : { $or: [{ promiseVersion: 0 }, { promiseVersion: { $exists: false } }] }) }, update, { new: true, runValidators: true });
  if (!updated) fail(409, 'CONFLICT', 'Invoice changed. Refresh before trying again.');
  res.status(action === 'created' ? 201 : 200).json({ itemId: String(updated._id),
    promises: itemPromiseStates(updated.toObject(), workspace.asOfDate) });
}
router.post('/items/:itemId/promises', asyncRoute((req, res) => change(req, res, 'created')));
router.patch('/items/:itemId/promises/:promiseId', asyncRoute((req, res) => change(req, res, 'revised')));
router.post('/items/:itemId/promises/:promiseId/cancel', asyncRoute((req, res) => change(req, res, 'cancelled')));
router.post('/items/:itemId/promises/:promiseId/receipts', asyncRoute((req, res) => change(req, res, 'receipt')));
export default router;
