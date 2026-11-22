import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';

const historySchema = new mongoose.Schema({
  status: { type: String, enum: ['accepted', 'in_production', 'ready_to_dispatch', 'delivered', 'cancelled'], required: true },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  at: { type: Date, required: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  orderScenarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderScenario', required: true },
  scenarioLabel: { type: String, required: true, trim: true, maxlength: 200 },
  customerName: { type: String, required: true, trim: true, maxlength: 160 },
  phone: { type: String, required: true, trim: true, maxlength: 16 },
  orderValuePaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  proposedAdvancePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  advanceAppliedPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  advanceCashItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CashItem', default: null },
  finalBalancePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  expectedDeliveryDate: { type: String, required: true, validate: isDateOnly },
  finalCollectionDate: { type: String, required: true, validate: isDateOnly },
  status: { type: String, enum: ['accepted', 'in_production', 'ready_to_dispatch', 'delivered', 'cancelled'], default: 'accepted' },
  statusNote: { type: String, trim: true, maxlength: 500, default: '' },
  statusHistory: { type: [historySchema], default: [] },
  dispatchDate: { type: String, validate: { validator: value => !value || isDateOnly(value) } },
  proofReference: { type: String, trim: true, maxlength: 500, default: '' },
  invoiceNumber: { type: String, trim: true, maxlength: 100, default: '' },
  invoiceDueDate: { type: String, validate: { validator: value => !value || isDateOnly(value) } },
  dispatchRequestId: { type: String, default: '' },
  invoiceCashItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CashItem', default: null },
  invoicedAt: Date,
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ workspaceId: 1, orderScenarioId: 1 }, { unique: true });
schema.index({ workspaceId: 1, advanceCashItemId: 1 }, { unique: true, partialFilterExpression: { advanceCashItemId: { $type: 'objectId' } } });
schema.index({ workspaceId: 1, status: 1, expectedDeliveryDate: 1 });
schema.index({ workspaceId: 1, invoiceCashItemId: 1 });

export default mongoose.model('FulfillmentOrder', schema);
