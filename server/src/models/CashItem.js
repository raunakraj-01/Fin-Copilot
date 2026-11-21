import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';

const constraints = new mongoose.Schema({
  mandatory: Boolean, negotiable: Boolean, discretionary: Boolean,
  maxExtensionDays: { type: Number, min: 0, max: 90 },
  earliestCollectionDate: { type: String, validate: { validator: value => !value || isDateOnly(value) } },
  maxEarlyCollectionPaise: { type: Number, min: 0, validate: value => value == null || Number.isSafeInteger(value) },
  estimatedActionCostPaise: { type: Number, default: null, min: 0 },
  actionCostDate: { type: String, validate: { validator: value => !value || isDateOnly(value) } },
}, { _id: false });

const promiseHistory = new mongoose.Schema({
  action: { type: String, enum: ['created', 'revised', 'cancelled', 'receipt'], required: true },
  at: { type: Date, required: true }, asOfDate: String, amountPaise: Number, promisedDate: String,
  receivedDate: String, statusBefore: String, note: String, requestId: String,
}, { _id: false });
const paymentPromise = new mongoose.Schema({
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  promisedDate: { type: String, required: true, validate: isDateOnly },
  receivedPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  closedAs: { type: String, enum: ['superseded', 'cancelled'] },
  history: { type: [promiseHistory], default: [] },
});

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  category: { type: String, enum: ['receivable', 'payable', 'expense'], required: true },
  externalId: { type: String, trim: true }, counterparty: { type: String, required: true, trim: true },
  description: String, sourceSystem: { type: String, enum: ['tally_export', 'excel', 'manual', 'csv'], required: true },
  importBatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch', default: null },
  importIdentity: String,
  tallyCompanyId: String, tallySourceId: String, tallyVersion: String,
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  settledPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  gatewayReceipts: { type: [{ paymentOfferId: String, amountPaise: Number, date: String }], default: [] },
  settlementEvents: { type: [{ source: { type: String, enum: ['bank', 'promise', 'tally', 'gateway'], required: true },
    sourceId: { type: String, required: true }, direction: { type: String, enum: ['receipt', 'payment'], required: true },
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }, date: { type: String, required: true, validate: isDateOnly },
    dueDate: { type: String, validate: { validator: value => !value || isDateOnly(value) } }, completedInvoice: { type: Boolean, default: false },
    verified: { type: Boolean, default: true }, reference: { type: String, default: '' } }], default: [] },
  paymentPromises: { type: [paymentPromise], default: [] },
  promiseVersion: { type: Number, default: 0 },
  status: { type: String, enum: ['open', 'partial', 'paid', 'cancelled'], default: 'open' },
  dueDate: { type: String, required: true, validate: isDateOnly },
  expectedDate: { type: String, validate: { validator: value => !value || isDateOnly(value) } },
  confidenceState: { type: String, enum: ['verified', 'owner_assumption', 'needs_review'], default: 'owner_assumption' },
  constraints, reviewIssues: { type: [String], default: [] }, notes: { type: String, default: '' },
}, { timestamps: true, optimisticConcurrency: true });

schema.pre('validate', function (next) {
  if (this.settledPaise > this.amountPaise) this.invalidate('settledPaise', 'Cannot exceed amountPaise');
  next();
});
schema.index({ workspaceId: 1, expectedDate: 1 });
schema.index({ workspaceId: 1, importIdentity: 1 }, { unique: true, partialFilterExpression: { importIdentity: { $type: 'string' } } });
schema.index({ workspaceId: 1, category: 1, status: 1 });
schema.index({ workspaceId: 1, category: 1, sourceSystem: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });
schema.index({ workspaceId: 1, tallyCompanyId: 1, tallySourceId: 1 },
  { unique: true, partialFilterExpression: { tallySourceId: { $type: 'string' } } });

export default mongoose.model('CashItem', schema);
