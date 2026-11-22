import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import InventoryItem from '../models/InventoryItem.js';
import { requireOwner } from './offers.js';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';

const router = Router({ mergeParams: true });
const quantity = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const input = z.object({
  name: z.string().trim().min(1).max(160), sku: z.string().trim().max(80).default(''),
  unit: z.string().trim().min(1).max(24).default('units'), supplier: z.string().trim().max(160).default(''),
  quantityOnHand: quantity, reorderPoint: quantity, reorderQuantity: quantity.positive(),
  leadTimeDays: z.number().int().min(0).max(365), unitCostPaise: quantity,
}).strict();
function checkPurchaseCost(data) {
  if (data.reorderQuantity != null && data.unitCostPaise != null
    && !Number.isSafeInteger(data.reorderQuantity * data.unitCostPaise))
    fail(400, 'VALIDATION_ERROR', 'Estimated reorder cost exceeds the supported amount range');
}
const present = item => ({ ...item, id: String(item._id), atReorderPoint: item.quantityOnHand <= item.reorderPoint,
  suggestedPurchaseCostPaise: item.reorderQuantity * item.unitCostPaise });

router.get('/', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  const items = await InventoryItem.find({ workspaceId: workspace._id, active: true }).sort({ name: 1 }).lean();
  const shaped = items.map(present);
  res.json({ items: shaped, lowStockCount: shaped.filter(item => item.atReorderPoint).length });
}));

router.post('/', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  const data = validate(input, req.body); checkPurchaseCost(data);
  const item = await InventoryItem.create({ ...data, sku: data.sku || undefined, workspaceId: req.params.workspaceId });
  res.status(201).json({ item: present(item.toObject()) });
}));

router.patch('/:itemId', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.itemId)) fail(404, 'NOT_FOUND', 'Stock item not found');
  const item = await InventoryItem.findOne({ _id: req.params.itemId, workspaceId: req.params.workspaceId, active: true });
  if (!item) fail(404, 'NOT_FOUND', 'Stock item not found');
  const data = validate(input.partial().strict(), req.body);
  if (!Object.keys(data).length) fail(400, 'VALIDATION_ERROR', 'Provide at least one stock field to update');
  checkPurchaseCost({ reorderQuantity: data.reorderQuantity ?? item.reorderQuantity, unitCostPaise: data.unitCostPaise ?? item.unitCostPaise });
  if (Object.hasOwn(data, 'sku') && !data.sku) data.sku = undefined;
  Object.assign(item, data);
  await item.save();
  res.json({ item: present(item.toObject()) });
}));

router.delete('/:itemId', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.itemId)) fail(404, 'NOT_FOUND', 'Stock item not found');
  const item = await InventoryItem.findOneAndUpdate({ _id: req.params.itemId, workspaceId: req.params.workspaceId, active: true },
    { $set: { active: false } }, { new: true });
  if (!item) fail(404, 'NOT_FOUND', 'Stock item not found');
  res.status(204).end();
}));

export default router;
