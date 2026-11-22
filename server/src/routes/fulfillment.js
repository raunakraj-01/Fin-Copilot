import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import CashItem from '../models/CashItem.js';
import CollectionFollowUp from '../models/CollectionFollowUp.js';
import FulfillmentOrder from '../models/FulfillmentOrder.js';
import OrderScenario from '../models/OrderScenario.js';
import { requireOwner } from './offers.js';
import { appendAudit } from '../services/audit.js';
import { eligible, liveFollowupsEnabled } from '../services/finance/followups.js';
import { loadDecisionContext } from '../services/rescue/decisionContext.js';
import { scenarioFreshness } from '../services/orders/freshness.js';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { dateOnly } from '../validators/finance.js';

const router = Router({ mergeParams: true });
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const phone = z.string().regex(/^\+?[0-9]{10,15}$/).transform(value => value.replace(/^\+/, ''));
const shape = order => ({ ...(typeof order.toObject === 'function' ? order.toObject() : order), id: String(order._id),
  orderScenarioId: String(order.orderScenarioId), invoiceCashItemId: order.invoiceCashItemId ? String(order.invoiceCashItemId) : null,
  advanceCashItemId: order.advanceCashItemId ? String(order.advanceCashItemId) : null });

router.get('/', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  const orders = await FulfillmentOrder.find({ workspaceId: workspace._id }).sort({ updatedAt: -1, _id: -1 }).limit(100).lean();
  res.json({ orders: orders.map(order => ({ ...order, id: String(order._id), orderScenarioId: String(order.orderScenarioId),
    invoiceCashItemId: order.invoiceCashItemId ? String(order.invoiceCashItemId) : null,
    advanceCashItemId: order.advanceCashItemId ? String(order.advanceCashItemId) : null })) });
}));

router.post('/', asyncRoute(async (req, res) => {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  const data = validate(z.object({ orderScenarioId: objectId, customerName: z.string().trim().min(1).max(160),
    phone, expectedDeliveryDate: dateOnly, finalCollectionDate: dateOnly.optional(),
    advanceCashItemId: objectId.optional() }).strict(), req.body);
  if (data.expectedDeliveryDate < workspace.asOfDate)
    fail(400, 'VALIDATION_ERROR', 'Expected delivery date must not precede the current cash snapshot');
  if (data.finalCollectionDate && data.finalCollectionDate < data.expectedDeliveryDate)
    fail(400, 'VALIDATION_ERROR', 'Final collection date cannot precede expected delivery');
  const scenario = await OrderScenario.findOne({ _id: data.orderScenarioId, workspaceId: workspace._id });
  if (!scenario) fail(404, 'NOT_FOUND', 'Saved order analysis not found for this business');
  const finalCollectionDate = data.finalCollectionDate || scenario.finalCollectionDate;
  if (finalCollectionDate < data.expectedDeliveryDate)
    fail(400, 'VALIDATION_ERROR', 'Final collection date cannot precede expected delivery');
  if (['completed', 'cancelled'].includes(scenario.trackingStatus)) fail(409, 'CONFLICT', 'Completed or cancelled order analyses cannot be started');
  const context = await loadDecisionContext(workspace._id);
  if (!context || scenarioFreshness(context, scenario).stale) fail(409, 'STALE_ORDER_ANALYSIS', 'Recalculate this saved order against current cash records before starting fulfillment tracking');

  const prior = await FulfillmentOrder.findOne({ workspaceId: workspace._id, orderScenarioId: scenario._id });
  if (prior) {
    if (prior.customerName !== data.customerName || prior.phone !== data.phone) fail(409, 'CONFLICT', 'This order is already being tracked for a different customer/contact');
    return res.status(200).json({ order: shape(prior), alreadyTracked: true });
  }
  let advanceAppliedPaise = 0;
  let advanceCashItemId = null;
  if (data.advanceCashItemId && scenario.advancePaise > 0) {
    const advanceItem = await CashItem.findOne({ _id: data.advanceCashItemId, workspaceId: workspace._id, category: 'receivable' });
    if (!advanceItem) fail(404, 'NOT_FOUND', 'Selected advance invoice was not found');
    if (advanceItem.amountPaise > scenario.advancePaise) fail(400, 'VALIDATION_ERROR', 'The linked advance invoice exceeds the saved order advance; reconcile the amount before starting tracking');
    if (await FulfillmentOrder.exists({ workspaceId: workspace._id, advanceCashItemId: advanceItem._id }))
      fail(409, 'CONFLICT', 'This advance invoice is already linked to another tracked order');
    // Deduct the already-issued advance invoice from the final invoice. Any receipts
    // already attached to that invoice remain there; fulfillment never creates receipts.
    advanceAppliedPaise = advanceItem.amountPaise;
    advanceCashItemId = advanceItem._id;
  }
  let order;
  try {
    order = await FulfillmentOrder.create({ workspaceId: workspace._id, orderScenarioId: scenario._id,
      scenarioLabel: scenario.label, customerName: data.customerName, phone: data.phone,
      orderValuePaise: scenario.orderValuePaise, proposedAdvancePaise: scenario.advancePaise,
      advanceAppliedPaise, advanceCashItemId,
      finalBalancePaise: Math.max(0, scenario.orderValuePaise - advanceAppliedPaise),
      expectedDeliveryDate: data.expectedDeliveryDate,
      finalCollectionDate: data.finalCollectionDate || scenario.finalCollectionDate,
      status: 'accepted', statusHistory: [{ status: 'accepted', note: 'Order tracking started from saved cash analysis', at: new Date(), actorUserId: req.user._id }] });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const concurrent = await FulfillmentOrder.findOne({ workspaceId: workspace._id, orderScenarioId: scenario._id });
    if (concurrent?.customerName === data.customerName && concurrent.phone === data.phone) return res.status(200).json({ order: shape(concurrent), alreadyTracked: true });
    if (data.advanceCashItemId && await FulfillmentOrder.exists({ workspaceId: workspace._id, advanceCashItemId: data.advanceCashItemId }))
      fail(409, 'CONFLICT', 'This advance invoice is already linked to another tracked order');
    fail(409, 'CONFLICT', 'This saved order is already tracked with different details');
  }
  await appendAudit({ workspaceId: workspace._id, userId: req.user._id, action: 'fulfillment.started',
    entityType: 'fulfillment_order', entityId: String(order._id), changedFields: ['customerName', 'phone', 'status'] });
  res.status(201).json({ order: shape(order) });
}));

router.patch('/:orderId/status', asyncRoute(async (req, res) => {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.orderId)) fail(404, 'NOT_FOUND', 'Fulfillment order not found');
  const data = validate(z.object({ status: z.enum(['accepted', 'in_production', 'ready_to_dispatch', 'cancelled']), note: z.string().trim().max(500).default('') }).strict(), req.body);
  const order = await FulfillmentOrder.findOne({ _id: req.params.orderId, workspaceId: workspace._id });
  if (!order) fail(404, 'NOT_FOUND', 'Fulfillment order not found');
  if (order.dispatchRequestId) fail(409, 'CONFLICT', 'Dispatch confirmation is in progress or complete; retry that dispatch request instead of changing status');
  if (order.invoiceCashItemId || order.status === 'delivered') fail(409, 'CONFLICT', 'A delivered/invoiced order cannot return to production stages');
  if (order.status === 'cancelled' && data.status !== 'cancelled') fail(409, 'CONFLICT', 'Cancelled orders cannot be reopened');
  if (data.status === order.status) return res.json({ order: shape(order), duplicate: true });
  const allowedNext = {
    accepted: ['in_production', 'ready_to_dispatch', 'cancelled'],
    in_production: ['accepted', 'ready_to_dispatch', 'cancelled'],
    ready_to_dispatch: ['in_production', 'cancelled'],
    cancelled: [],
  };
  if (!allowedNext[order.status]?.includes(data.status))
    fail(409, 'INVALID_TRANSITION', `Cannot move this order from ${order.status} to ${data.status}`);
  if (order.statusHistory.length >= 100) fail(400, 'VALIDATION_ERROR', 'Order status history limit reached');
  order.status = data.status; order.statusNote = data.note;
  order.statusHistory.push({ status: data.status, note: data.note, at: new Date(), actorUserId: req.user._id });
  await order.save();
  await appendAudit({ workspaceId: workspace._id, userId: req.user._id, action: 'fulfillment.status_changed',
    entityType: 'fulfillment_order', entityId: String(order._id), changedFields: ['status', 'statusNote'] });
  res.json({ order: shape(order) });
}));

router.post('/:orderId/dispatch', asyncRoute(async (req, res) => {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.orderId)) fail(404, 'NOT_FOUND', 'Fulfillment order not found');
  const data = validate(z.object({ requestId: z.string().uuid(), dispatchDate: dateOnly,
    proofReference: z.string().trim().min(1).max(500), invoiceDueDate: dateOnly,
    invoiceNumber: z.string().trim().max(100).default('') }).strict(), req.body);
  let order = await FulfillmentOrder.findOne({ _id: req.params.orderId, workspaceId: workspace._id });
  if (!order) fail(404, 'NOT_FOUND', 'Fulfillment order not found');
  if (order.dispatchRequestId) {
    if (order.dispatchRequestId !== data.requestId || order.dispatchDate !== data.dispatchDate
      || order.proofReference !== data.proofReference || order.invoiceDueDate !== data.invoiceDueDate
      || order.invoiceNumber !== data.invoiceNumber)
      fail(409, 'CONFLICT', 'This order was already dispatched with different details');
    if (order.status === 'delivered' && (order.finalBalancePaise === 0 || order.invoiceCashItemId))
      return res.json({ order: shape(order), duplicate: true });
  } else {
    if (order.status !== 'ready_to_dispatch') fail(409, 'CONFLICT', 'Move the order to Ready to dispatch before confirming delivery');
    if (data.dispatchDate < workspace.asOfDate || data.invoiceDueDate <= workspace.asOfDate)
      fail(400, 'VALIDATION_ERROR', 'Dispatch must not precede the cash snapshot and invoice due date must be in the forecast future');
  if (data.dispatchDate < order.expectedDeliveryDate)
    fail(400, 'VALIDATION_ERROR', 'Dispatch date cannot precede the expected delivery date');
    if (data.invoiceDueDate < data.dispatchDate) fail(400, 'VALIDATION_ERROR', 'Invoice due date cannot precede dispatch');
    if (order.statusHistory.length >= 100) fail(400, 'VALIDATION_ERROR', 'Order status history limit reached');
    order = await FulfillmentOrder.findOneAndUpdate({ _id: order._id, workspaceId: workspace._id,
      status: 'ready_to_dispatch', dispatchRequestId: '', __v: order.__v }, {
      $set: { dispatchDate: data.dispatchDate, proofReference: data.proofReference,
        invoiceNumber: data.invoiceNumber, invoiceDueDate: data.invoiceDueDate, dispatchRequestId: data.requestId },
      $inc: { __v: 1 },
    }, { new: true });
    if (!order) {
      order = await FulfillmentOrder.findOne({ _id: req.params.orderId, workspaceId: workspace._id });
      if (!order || order.dispatchRequestId !== data.requestId || order.dispatchDate !== data.dispatchDate
        || order.proofReference !== data.proofReference || order.invoiceDueDate !== data.invoiceDueDate
        || order.invoiceNumber !== data.invoiceNumber)
        fail(409, 'CONFLICT', 'Order changed during dispatch confirmation. Refresh and retry the same request.');
    } else {
      await appendAudit({ workspaceId: workspace._id, userId: req.user._id, action: 'fulfillment.dispatch_started',
        entityType: 'fulfillment_order', entityId: String(order._id), changedFields: ['dispatchDate', 'proofReference', 'invoiceNumber', 'invoiceDueDate'] });
    }
  }

  const invoiceId = data.invoiceNumber || `FUL-${String(order._id).toUpperCase()}`;
  let cashItem = null;
  if (order.finalBalancePaise > 0) {
    await CashItem.init();
    const notes = `Fulfillment order ${order._id}. Final balance only; advance invoice amount ${order.advanceAppliedPaise} paise is already represented${order.advanceCashItemId ? ` by cash item ${order.advanceCashItemId}` : ''}. No advance receipt was added.`;
    const candidate = { workspaceId: workspace._id, category: 'receivable', sourceSystem: 'manual', externalId: invoiceId };
    const sameExternalIds = await CashItem.find({ workspaceId: workspace._id, category: 'receivable', externalId: invoiceId }).limit(3);
    if (sameExternalIds.length > 1) fail(409, 'CONFLICT', `Invoice ID ${invoiceId} appears more than once in the ledger. Reconcile it before dispatch.`);
    if (sameExternalIds.length === 1) {
      const existing = sameExternalIds[0];
      const sameCustomer = existing.counterparty.trim().toLocaleLowerCase() === order.customerName.trim().toLocaleLowerCase();
      const sameOrder = existing.notes?.includes(`Fulfillment order ${order._id}`);
      if (existing.amountPaise !== order.finalBalancePaise || !sameCustomer
        || existing.dueDate !== data.invoiceDueDate && !sameOrder)
        fail(409, 'CONFLICT', `Invoice ID ${invoiceId} is already in use with different invoice details.`);
      cashItem = existing;
    }
    if (!cashItem) cashItem = await CashItem.findOne(candidate);
    if (cashItem) {
      if (cashItem.amountPaise !== order.finalBalancePaise
        || cashItem.sourceSystem === 'manual' && !cashItem.notes?.includes(`Fulfillment order ${order._id}`))
        fail(409, 'CONFLICT', `Invoice ID ${invoiceId} is already in use. Choose a different invoice number.`);
    } else {
      try {
        cashItem = await CashItem.create({ ...candidate, counterparty: order.customerName,
          description: `Final balance for ${order.scenarioLabel}`, amountPaise: order.finalBalancePaise, settledPaise: 0,
          dueDate: data.invoiceDueDate, expectedDate: data.invoiceDueDate, status: 'open', confidenceState: 'owner_assumption', notes });
      } catch (error) {
        if (error.code !== 11000) throw error;
        cashItem = await CashItem.findOne(candidate);
        if (!cashItem || cashItem.amountPaise !== order.finalBalancePaise || !cashItem.notes?.includes(`Fulfillment order ${order._id}`))
          fail(409, 'CONFLICT', `Invoice ID ${invoiceId} is already in use. Choose a different invoice number.`);
      }
    }
  }
  const now = new Date();
  const update = await FulfillmentOrder.updateOne({ _id: order._id, workspaceId: workspace._id,
    dispatchRequestId: data.requestId, status: 'ready_to_dispatch', invoiceCashItemId: null }, {
    $set: { status: 'delivered', statusNote: `Dispatched with proof ${data.proofReference}`,
      invoiceNumber: order.finalBalancePaise > 0 ? invoiceId : '', invoiceCashItemId: cashItem?._id || null, invoicedAt: cashItem ? now : null },
    $push: { statusHistory: { status: 'delivered', note: `Dispatch confirmed · ${data.proofReference}`, at: now, actorUserId: req.user._id } },
    $inc: { __v: 1 },
  });
  if (!update.modifiedCount) {
    const latest = await FulfillmentOrder.findOne({ _id: order._id, workspaceId: workspace._id });
    if (latest?.dispatchRequestId === data.requestId
      && String(latest.invoiceCashItemId || '') === String(cashItem?._id || '')) return res.json({ order: shape(latest), duplicate: true });
    fail(409, 'CONFLICT', 'Order changed during dispatch confirmation. Refresh and retry the same request.');
  }
  const updated = await FulfillmentOrder.findOne({ _id: order._id, workspaceId: workspace._id });
  await appendAudit({ workspaceId: workspace._id, userId: req.user._id, action: 'fulfillment.dispatched',
    entityType: 'fulfillment_order', entityId: String(order._id), changedFields: ['dispatchDate', 'proofReference', 'invoiceNumber', 'invoiceCashItemId'] });
  res.status(201).json({ order: shape(updated), invoice: cashItem ? { id: String(cashItem._id), externalId: invoiceId,
    amountPaise: order.finalBalancePaise, dueDate: data.invoiceDueDate } : null, invoiceAlreadyPaid: order.finalBalancePaise === 0,
    message: cashItem ? 'Dispatch recorded and final-balance receivable created once. No payment or advance receipt was added.' : 'Dispatch recorded. No receivable remains after the advance already represented in the ledger.' });
}));

router.post('/:orderId/collection-followup', asyncRoute(async (req, res) => {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.orderId)) fail(404, 'NOT_FOUND', 'Fulfillment order not found');
  const data = validate(z.object({ recipientOptIn: z.boolean().default(false), mode: z.enum(['demo', 'n8n']).default('demo'),
    cadenceDays: z.number().int().min(1).max(30).default(3), maxAttempts: z.number().int().min(1).max(5).default(3) }).strict(), req.body);
  const order = await FulfillmentOrder.findOne({ _id: req.params.orderId, workspaceId: workspace._id });
  if (!order?.invoiceCashItemId) fail(409, 'CONFLICT', 'Confirm dispatch and create the receivable before scheduling collection');
  if (data.mode === 'n8n' && (!liveFollowupsEnabled() || !data.recipientOptIn)) fail(400, 'LIVE_DISABLED', 'Live WhatsApp reminders require server setup and this customer\'s opt-in');
  const invoice = await CashItem.findOne({ _id: order.invoiceCashItemId, workspaceId: workspace._id }).lean();
  if (!eligible(invoice)) fail(409, 'CONFLICT', 'This invoice is no longer eligible for follow-up');
  const existing = await CollectionFollowUp.findOne({ workspaceId: workspace._id, cashItemId: order.invoiceCashItemId });
  if (existing) return res.json({ scheduled: true, existing: true, mode: existing.mode, message: 'A follow-up schedule already exists for this invoice.' });
  let rule;
  try {
    rule = await CollectionFollowUp.findOneAndUpdate({ workspaceId: workspace._id, cashItemId: order.invoiceCashItemId, claimId: null },
      { $set: { phone: order.phone, mode: data.mode, recipientOptIn: data.recipientOptIn, cadenceDays: data.cadenceDays,
        maxAttempts: data.maxAttempts, state: 'active', attempts: 0, nextRunAt: new Date(), lastOutcome: 'Scheduled', claimId: null } },
      { upsert: true, new: true, runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    rule = await CollectionFollowUp.findOne({ workspaceId: workspace._id, cashItemId: order.invoiceCashItemId });
    if (!rule) throw error;
    return res.json({ scheduled: true, existing: true, mode: rule.mode, message: 'A follow-up schedule already exists for this invoice.' });
  }
  await appendAudit({ workspaceId: workspace._id, userId: req.user._id, action: 'fulfillment.followup_scheduled',
    entityType: 'fulfillment_order', entityId: String(order._id), changedFields: ['followup'] });
  res.status(201).json({ scheduled: true, mode: rule.mode, message: rule.mode === 'demo' ? 'Local reminder drafts scheduled. No WhatsApp message was sent.' : 'Opted-in WhatsApp follow-up scheduled.' });
}));

export default router;
