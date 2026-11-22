import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';

const transition = new mongoose.Schema({
  from: { type: String, enum: ['draft', 'quote_received', 'approved', 'ordered', 'received', 'cancelled'], required: true },
  to: { type: String, enum: ['draft', 'quote_received', 'approved', 'ordered', 'received', 'cancelled'], required: true },
  at: { type: Date, required: true },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });

const analysis = new mongoose.Schema({
  analyzedAt: { type: Date, required: true },
  inventoryVersion: Number,
  quoteAmountPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  paymentDueDate: { type: String, required: true, validate: isDateOnly },
  baselineFirstReserveBreachDate: String,
  purchaseFirstReserveBreachDate: String,
  incrementalReserveBreachDate: String,
  baselineWorstCashPaise: { type: Number, required: true, validate: Number.isSafeInteger },
  purchaseWorstCashPaise: { type: Number, required: true, validate: Number.isSafeInteger },
  reservePaise: { type: Number, required: true, validate: Number.isSafeInteger },
  safeToSchedule: { type: Boolean, required: true },
}, { _id: false });

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  sku: { type: String, trim: true, maxlength: 80, default: '' },
  unit: { type: String, required: true, trim: true, maxlength: 24 },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  supplier: { type: String, required: true, trim: true, maxlength: 160 },
  supplierPhone: { type: String, trim: true, maxlength: 16, default: '' },
  estimatedUnitCostPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  estimatedAmountPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  quoteAmountPaise: { type: Number, min: 1, validate: value => value == null || Number.isSafeInteger(value) },
  leadTimeDays: { type: Number, required: true, min: 0, max: 365, validate: Number.isInteger },
  paymentTermsDays: { type: Number, default: 0, min: 0, max: 365, validate: Number.isInteger },
  orderDate: { type: String, required: true, validate: isDateOnly },
  expectedDeliveryDate: { type: String, required: true, validate: isDateOnly },
  paymentDueDate: { type: String, required: true, validate: isDateOnly },
  status: { type: String, enum: ['draft', 'quote_received', 'approved', 'ordered', 'received', 'cancelled'], default: 'draft' },
  lastAnalysis: analysis,
  planningCommitmentId: { type: String, default: null },
  ownerApprovedAt: Date,
  ownerApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  orderedAt: Date,
  receivedAt: Date,
  receiptRequestId: String,
  receiptAppliedAt: Date,
  transitions: { type: [transition], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ workspaceId:  1, status: 1, paymentDueDate: 1 });
schema.index({ workspaceId: 1, planningCommitmentId: 1 }, { unique: true, partialFilterExpression: { planningCommitmentId: { $type: 'string' } } });
schema.index({ workspaceId: 1, receiptRequestId: 1 }, { unique: true, partialFilterExpression: { receiptRequestId: { $type: 'string' } } });

export default mongoose.model('ProcurementRequest', schema);
