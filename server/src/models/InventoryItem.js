import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  sku: { type: String, trim: true, maxlength: 80 },
  unit: { type: String, trim: true, maxlength: 24, default: 'units' },
  supplier: { type: String, trim: true, maxlength: 160, default: '' },
  quantityOnHand: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  reorderPoint: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  reorderQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  leadTimeDays: { type: Number, required: true, min: 0, max: 365, validate: Number.isInteger },
  unitCostPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  // Durable idempotency markers let concurrent receipt retries update stock once.
  // Hidden from ordinary reads; retained so interrupted retries can be recovered safely.
  procurementReceiptIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProcurementReceipt' }], default: [], select: false },
  active: { type: Boolean, default: true },
}, { timestamps: true });

schema.index({ workspaceId: 1, sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string' } } });
schema.index({ workspaceId: 1, active: 1, quantityOnHand: 1, reorderPoint: 1 });

export default mongoose.model('InventoryItem', schema);
