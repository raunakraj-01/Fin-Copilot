import { Router } from 'express';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import InventoryItem from '../models/InventoryItem.js';
import ProcurementRequest from '../models/ProcurementRequest.js';
import ProcurementReceipt from '../models/ProcurementReceipt.js';
import { analyzeProcurement } from '../services/finance/procurement.js';
import { requireOwner } from './offers.js';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { dateOnly, paise } from '../validators/finance.js';

const router = Router({ mergeParams: true });
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const days = z.number().int().min(0).max(365);
const plusDays = (date, count) => {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
};
const describe = request => ({ ...request, id: String(request._id),
  estimatedCostPaise: request.quoteAmountPaise || request.estimatedAmountPaise,
  receiptPending: request.status === 'received' && !request.receiptAppliedAt });

router.get('/', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  const requests = await ProcurementRequest.find({ workspaceId: workspace._id }).sort({ updatedAt: -1, _id: -1 }).limit(100).lean();
  res.json({ requests: requests.map(describe), planningOnly: true });
}));

router.post('/', asyncRoute(async (req, res) => {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  const data = validate(z.object({ inventoryItemId: objectId, quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    supplier: z.string().trim().min(1).max(160).optional(), supplierPhone: z.string().trim().max(16).default(''),
    orderDate: dateOnly.optional(), paymentTermsDays: days.default(0) }).strict(), req.body);
  const inventory = await InventoryItem.findOne({ _id: data.inventoryItemId, workspaceId: workspace._id, active: true }).lean();
  if (!inventory) fail(404, 'NOT_FOUND', 'Active stock item not found for this business');
  const orderDate = data.orderDate || plusDays(workspace.asOfDate, 1);
  if (orderDate <= workspace.asOfDate) fail(400, 'VALIDATION_ERROR', 'Proposed order date must follow the cash snapshot');
  const estimatedAmountPaise = data.quantity * inventory.unitCostPaise;
  if (!Number.isSafeInteger(estimatedAmountPaise)) fail(400, 'VALIDATION_ERROR', 'Estimated purchase amount is too large');
  const request = await ProcurementRequest.create({ workspaceId: workspace._id, inventoryItemId: inventory._id,
    name: inventory.name, sku: inventory.sku || '', unit: inventory.unit, quantity: data.quantity,
    supplier: data.supplier || inventory.supplier || 'Supplier to confirm', supplierPhone: data.supplierPhone,
    estimatedUnitCostPaise: inventory.unitCostPaise, estimatedAmountPaise,
    leadTimeDays: inventory.leadTimeDays, paymentTermsDays: data.paymentTermsDays,
    orderDate, expectedDeliveryDate: plusDays(orderDate, inventory.leadTimeDays),
    paymentDueDate: plusDays(plusDays(orderDate, inventory.leadTimeDays), data.paymentTermsDays), status: 'draft', createdBy: req.user._id,
  });
  res.status(201).json({ request: describe(request.toObject()), message: 'Draft created. No purchase order was sent and no payment was made.' });
}));

router.patch('/:requestId/quote', asyncRoute(async (req, res) => {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.requestId)) fail(404, 'NOT_FOUND', 'Procurement request not found');
  const data = validate(z.object({ quoteAmountPaise: paise.positive(), leadTimeDays: days,
    paymentTermsDays: days, orderDate: dateOnly, supplier: z.string().trim().min(1).max(160),
    supplierPhone: z.string().trim().max(16).default('') }).strict(), req.body);
  if (data.orderDate <= workspace.asOfDate) fail(400, 'VALIDATION_ERROR', 'Proposed order date must follow the cash snapshot');
  const request = await ProcurementRequest.findOne({ _id: req.params.requestId, workspaceId: workspace._id });
  if (!request) fail(404, 'NOT_FOUND', 'Procurement request not found');
  if (request.status !== 'draft') fail(409, 'CONFLICT', 'Only a draft can receive a supplier quote');
  const quoteUnitCostPaise = Math.ceil(data.quoteAmountPaise / request.quantity);
  if (!Number.isSafeInteger(quoteUnitCostPaise)) fail(400, 'VALIDATION_ERROR', 'Quote amount is outside the supported range');
  const at = new Date();
  request.quoteAmountPaise = data.quoteAmountPaise;
  request.estimatedUnitCostPaise = quoteUnitCostPaise;
  request.leadTimeDays = data.leadTimeDays;
  request.paymentTermsDays = data.paymentTermsDays;
  request.orderDate = data.orderDate;
  request.expectedDeliveryDate = plusDays(data.orderDate, data.leadTimeDays);
  request.paymentDueDate = plusDays(plusDays(data.orderDate, data.leadTimeDays), data.paymentTermsDays);
  request.supplier = data.supplier;
  request.supplierPhone = data.supplierPhone;
  request.status = 'quote_received';
  request.transitions.push({ from: 'draft', to: 'quote_received', at, note: 'Supplier quote recorded', actorUserId: req.user._id });
  await request.save();
  res.json({ request: describe(request.toObject()) });
}));

router.post('/:requestId/analyze', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.requestId)) fail(404, 'NOT_FOUND', 'Procurement request not found');
  validate(z.object({}).strict(), req.body ?? {});
  const request = await ProcurementRequest.findOne({ _id: req.params.requestId, workspaceId: req.params.workspaceId });
  if (!request) fail(404, 'NOT_FOUND', 'Procurement request not found');
  if (!['draft', 'quote_received', 'approved', 'ordered'].includes(request.status)) fail(409, 'CONFLICT', 'This procurement request is no longer active');
  const result = await analyzeProcurement(req.params.workspaceId, request);
  request.lastAnalysis = { analyzedAt: result.analyzedAt, inventoryVersion: request.__v,
    quoteAmountPaise: result.amountPaise, paymentDueDate: result.paymentDueDate,
    baselineFirstReserveBreachDate: result.baseline.firstReserveBreachDate,
    purchaseFirstReserveBreachDate: result.withPurchase.firstReserveBreachDate,
    incrementalReserveBreachDate: result.incrementalReserveBreachDate,
    baselineWorstCashPaise: result.baseline.worstCashPaise, purchaseWorstCashPaise: result.withPurchase.worstCashPaise,
    reservePaise: result.reservePaise, safeToSchedule: result.safeToSchedule };
  await request.save();
  res.json({ analysis: result, request: describe(request.toObject()) });
}));

router.patch('/:requestId/status', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.requestId)) fail(404, 'NOT_FOUND', 'Procurement request not found');
  const data = validate(z.object({ status: z.enum(['approved', 'ordered', 'cancelled']),
    cashRiskAcknowledged: z.boolean().default(false), note: z.string().trim().max(500).default('') }).strict(), req.body);
  const request = await ProcurementRequest.findOne({ _id: req.params.requestId, workspaceId: req.params.workspaceId });
  if (!request) fail(404, 'NOT_FOUND', 'Procurement request not found');
  if (request.status === data.status) return res.json({ request: describe(request.toObject()), duplicate: true });
  const allowed = data.status === 'approved' ? request.status === 'quote_received'
    : data.status === 'ordered' ? request.status === 'approved'
      : ['draft', 'quote_received', 'approved', 'ordered'].includes(request.status);
  if (!allowed) fail(409, 'CONFLICT', `Cannot move a ${request.status} request to ${data.status}`);
  let liveAnalysis = null;
  if (data.status === 'approved') {
    liveAnalysis = await analyzeProcurement(req.params.workspaceId, request);
    if (!liveAnalysis.safeToSchedule && !data.cashRiskAcknowledged)
      fail(409, 'CASH_REVIEW_REQUIRED', 'This supplier payment may breach the cash reserve. Review the cash analysis and acknowledge the risk to approve.',
        [{ field: 'cashRiskAcknowledged', message: 'Approval needs explicit acknowledgement of the cash risk' }]);
  }
  const from = request.status; const at = new Date();
  request.status = data.status;
  request.transitions.push({ from, to: data.status, at, note: data.note, actorUserId: req.user._id });
  if (data.status === 'approved') {
    request.planningCommitmentId ||= `procurement-${randomUUID()}`;
    request.ownerApprovedAt = at; request.ownerApprovedBy = req.user._id;
    if (liveAnalysis) request.lastAnalysis = { analyzedAt: liveAnalysis.analyzedAt, inventoryVersion: request.__v,
      quoteAmountPaise: liveAnalysis.amountPaise, paymentDueDate: liveAnalysis.paymentDueDate,
      baselineFirstReserveBreachDate: liveAnalysis.baseline.firstReserveBreachDate,
      purchaseFirstReserveBreachDate: liveAnalysis.withPurchase.firstReserveBreachDate,
      incrementalReserveBreachDate: liveAnalysis.incrementalReserveBreachDate,
      baselineWorstCashPaise: liveAnalysis.baseline.worstCashPaise, purchaseWorstCashPaise: liveAnalysis.withPurchase.worstCashPaise,
      reservePaise: liveAnalysis.reservePaise, safeToSchedule: liveAnalysis.safeToSchedule };
  }
  if (data.status === 'ordered') request.orderedAt = at;
  await request.save();
  res.json({ request: describe(request.toObject()), analysis: liveAnalysis,
    message: data.status === 'approved' ? 'Planning commitment recorded. No purchase order was sent and no payment was made.' : undefined });
}));

router.post('/:requestId/receive', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.requestId)) fail(404, 'NOT_FOUND', 'Procurement request not found');
  const { requestId } = validate(z.object({ requestId: z.string().uuid() }).strict(), req.body);
  const request = await ProcurementRequest.findOne({ _id: req.params.requestId, workspaceId: req.params.workspaceId });
  if (!request) fail(404, 'NOT_FOUND', 'Procurement request not found');
  if (request.receiptRequestId && request.receiptRequestId !== requestId) fail(409, 'CONFLICT', 'A different stock receipt is already recorded for this purchase');
  if (!['ordered', 'received'].includes(request.status)) fail(409, 'CONFLICT', 'Only an ordered purchase can be received');
  const inventory = await InventoryItem.findOne({ _id: request.inventoryItemId, workspaceId: request.workspaceId, active: true }).lean();
  if (!inventory) fail(404, 'NOT_FOUND', 'Stock item no longer exists; resolve this receipt manually');
  const beforeQuantity = inventory.quantityOnHand;
  const afterQuantity = beforeQuantity + request.quantity;
  if (!Number.isSafeInteger(afterQuantity)) fail(400, 'VALIDATION_ERROR', 'Received quantity exceeds the supported range');
  let receipt = await ProcurementReceipt.findOne({ workspaceId: request.workspaceId, procurementRequestId: request._id });
  if (!receipt) {
    try {
      receipt = await ProcurementReceipt.create({ workspaceId: request.workspaceId, procurementRequestId: request._id,
        inventoryItemId: inventory._id, requestId, beforeQuantity, receivedQuantity: request.quantity, afterQuantity,
        applicationMode: 'atomic_v1', status: 'pending' });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      receipt = await ProcurementReceipt.findOne({ workspaceId: request.workspaceId, procurementRequestId: request._id });
      if (!receipt || receipt.requestId !== requestId) fail(409, 'CONFLICT', 'This purchase already has a stock receipt');
    }
  } else if (receipt.requestId !== requestId) fail(409, 'CONFLICT', 'This purchase already has a stock receipt');

  if (request.status === 'ordered') {
    const at = new Date();
    const updated = await ProcurementRequest.findOneAndUpdate({ _id: request._id, workspaceId: request.workspaceId, __v: request.__v, status: 'ordered' }, {
      $set: { status: 'received', receiptRequestId: requestId, receivedAt: at },
      $push: { transitions: { from: 'ordered', to: 'received', at, note: 'Stock receipt recorded', actorUserId: req.user._id } },
      $inc: { __v: 1 },
    }, { new: true, runValidators: true });
    if (!updated) {
      const latest = await ProcurementRequest.findOne({ _id: request._id, workspaceId: request.workspaceId });
      if (!latest || latest.status !== 'received' || latest.receiptRequestId !== requestId) fail(409, 'CONFLICT', 'Purchase changed; refresh before receiving it');
    }
  } else if (request.receiptRequestId !== requestId) {
    // Recover a process interruption after the receipt record was created.
    const updated = await ProcurementRequest.updateOne({ _id: request._id, workspaceId: request.workspaceId,
      status: 'received', receiptRequestId: { $in: [null, requestId] } }, { $set: { receiptRequestId: requestId, receivedAt: request.receivedAt || new Date() } });
    if (!updated.modifiedCount && !await ProcurementRequest.exists({ _id: request._id, receiptRequestId: requestId }))
      fail(409, 'CONFLICT', 'Purchase receipt changed; refresh before retrying');
  }

  if (receipt.status === 'conflict') fail(409, 'STOCK_CHANGED', 'This receipt needs manual stock reconciliation before it can be retried.');
  if (receipt.status !== 'applied') {
    const markApplied = async () => {
      await ProcurementReceipt.updateOne({ _id: receipt._id, status: 'pending' }, { $set: { status: 'applied', appliedAt: new Date() } });
      const latestReceipt = await ProcurementReceipt.findById(receipt._id).lean();
      if (!latestReceipt || latestReceipt.status !== 'applied') fail(409, 'RECEIPT_CONFLICT', 'Receipt state changed while applying stock. Refresh and reconcile this receipt.');
      receipt = latestReceipt;
    };

    if (receipt.applicationMode === 'atomic_v1') {
      const markerId = receipt._id;
      const maxBeforeApply = Number.MAX_SAFE_INTEGER - receipt.receivedQuantity;
      const applied = await InventoryItem.collection.updateOne({
        _id: receipt.inventoryItemId,
        workspaceId: receipt.workspaceId,
        active: true,
        $or: [
          { procurementReceiptIds: markerId },
          { $and: [
            { procurementReceiptIds: { $ne: markerId } },
            { quantityOnHand: { $lte: maxBeforeApply } },
          ] },
        ],
      }, [{ $set: {
        quantityOnHand: { $cond: [
          { $in: [{ $literal: markerId }, { $ifNull: ['$procurementReceiptIds', []] }] },
          '$quantityOnHand',
          { $add: ['$quantityOnHand', { $literal: receipt.receivedQuantity }] },
        ] },
        procurementReceiptIds: { $setUnion: [
          { $ifNull: ['$procurementReceiptIds', []] },
          [{ $literal: markerId }],
        ] },
      } }]);
      if (!applied.matchedCount) {
        const current = await InventoryItem.findOne({ _id: receipt.inventoryItemId, workspaceId: receipt.workspaceId }).lean();
        if (!current) fail(404, 'NOT_FOUND', 'Stock item no longer exists; resolve this receipt manually');
        if (!current.active) fail(409, 'STOCK_CHANGED', 'Stock item was archived before this receipt could be applied. Restore it or reconcile the receipt manually.');
        fail(409, 'STOCK_CAPACITY', 'Adding this receipt would exceed the supported stock quantity. Adjust the stock record, then retry.');
      }
      // Inventory update and marker are atomic. A retry after interruption sees the marker and does not increment again.
      await markApplied();
    } else {
      // Recover pending records written by the earlier compare-and-set implementation.
      // Once recovered, add a durable marker so all subsequent retries use the atomic path.
      const current = await InventoryItem.findOne({ _id: receipt.inventoryItemId, workspaceId: receipt.workspaceId }).lean();
      if (!current) fail(404, 'NOT_FOUND', 'Stock item no longer exists; resolve this receipt manually');
      if (!current.active) fail(409, 'STOCK_CHANGED', 'Stock item was archived before this receipt could be applied. Restore it or reconcile the receipt manually.');
      let recovered = false;
      if (current.quantityOnHand === receipt.beforeQuantity) {
        const legacyApply = await InventoryItem.collection.updateOne({ _id: current._id, workspaceId: current.workspaceId,
          active: true, quantityOnHand: receipt.beforeQuantity }, {
          $set: { quantityOnHand: receipt.afterQuantity }, $addToSet: { procurementReceiptIds: receipt._id },
        });
        recovered = legacyApply.modifiedCount === 1;
      }
      if (!recovered) {
        // A concurrent retry may have won the legacy compare-and-set after our read.
        const latest = await InventoryItem.findOne({ _id: current._id, workspaceId: current.workspaceId }).lean();
        if (latest?.active && latest.quantityOnHand === receipt.afterQuantity) {
          const legacyRecovery = await InventoryItem.collection.updateOne({ _id: latest._id, workspaceId: latest.workspaceId,
            active: true, quantityOnHand: receipt.afterQuantity }, { $addToSet: { procurementReceiptIds: receipt._id } });
          recovered = legacyRecovery.matchedCount === 1;
        }
      }
      if (!recovered) {
        await ProcurementReceipt.updateOne({ _id: receipt._id, status: 'pending' }, { $set: { status: 'conflict' } });
        fail(409, 'STOCK_CHANGED', 'Stock changed before this older receipt could be recovered. Reconcile the stock quantity manually.');
      }
      await markApplied();
    }
  }
  await ProcurementRequest.updateOne({ _id: request._id, workspaceId: request.workspaceId, receiptRequestId: requestId,
    receiptAppliedAt: null }, { $set: { receiptAppliedAt: new Date() } });
  const finished = await ProcurementRequest.findOne({ _id: request._id, workspaceId: request.workspaceId }).lean();
  const updatedReceipt = await ProcurementReceipt.findById(receipt._id).lean();
  res.json({ request: describe(finished), receipt: updatedReceipt, duplicate: request.status === 'received' && Boolean(request.receiptAppliedAt),
    message: 'Received quantity added to stock once. No supplier payment was made.' });
}));

router.post('/:requestId/analyze-preview', asyncRoute(async (req, res) => {
  requireOwner(req);
  if (!mongoose.isValidObjectId(req.params.requestId)) fail(404, 'NOT_FOUND', 'Procurement request not found');
  validate(z.object({}).strict(), req.body ?? {});
  const request = await ProcurementRequest.findOne({ _id: req.params.requestId, workspaceId: req.params.workspaceId });
  if (!request) fail(404, 'NOT_FOUND', 'Procurement request not found');
  const result = await analyzeProcurement(req.params.workspaceId, request);
  res.json({ analysis: result });
}));

export default router;
