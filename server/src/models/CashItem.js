import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';

const constraints = new mongoose.Schema({
  mandatory: Boolean, negotiable: Boolean, discretionary: Boolean,
  maxExtensionDays: { type: Number, min: 0, max: 90 },
  earliestCollectionDate: { type: String, validate: { validator: value => !value || isDateOnly(value) } },
  maxEarlyCollectionPaise: { type: Number, min: 0, validate: Number.isSafeInteger },
  estimatedActionCostPaise: { type: Number, default: null, min: 0 },
}, { _id: false });

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  category: { type: String, enum: ['receivable', 'payable', 'expense'], required: true },
  externalId: { type: String, trim: true }, counterparty: { type: String, required: true, trim: true },
  description: String, sourceSystem: { type: String, enum: ['tally_export', 'excel', 'manual', 'csv'], required: true },
  importBatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch', default: null },
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  settledPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  status: { type: String, enum: ['open', 'partial', 'paid', 'cancelled'], default: 'open' },
  dueDate: { type: String, required: true, validate: isDateOnly },
  expectedDate: { type: String, validate: { validator: value => !value || isDateOnly(value) } },
  confidenceState: { type: String, enum: ['verified', 'owner_assumption', 'needs_review'], default: 'owner_assumption' },
  constraints, reviewIssues: { type: [String], default: [] }, notes: { type: String, default: '' },
}, { timestamps: true });

schema.pre('validate', function (next) {
  if (this.settledPaise > this.amountPaise) this.invalidate('settledPaise', 'Cannot exceed amountPaise');
  next();
});
schema.index({ workspaceId: 1, expectedDate: 1 });
schema.index({ workspaceId: 1, category: 1, status: 1 });
schema.index({ workspaceId: 1, category: 1, sourceSystem: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });

export default mongoose.model('CashItem', schema);
