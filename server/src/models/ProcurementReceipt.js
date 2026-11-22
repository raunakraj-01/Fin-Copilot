import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  procurementRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProcurementRequest', required: true },
  inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  requestId: { type: String, required: true },
  beforeQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  receivedQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  afterQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  applicationMode: { type: String, enum: ['legacy_cas', 'atomic_v1'], default: 'legacy_cas' },
  status: { type: String, enum: ['pending', 'applied', 'conflict'], default: 'pending' },
  appliedAt: Date,
}, { timestamps: true });

schema.index({ workspaceId: 1, procurementRequestId: 1 }, { unique: true });
schema.index({ workspaceId: 1, requestId: 1 }, { unique: true });

export default mongoose.model('ProcurementReceipt', schema);
