import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';

const dateField = { type: String, required: true, validate: isDateOnly };
const money = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
const actionSchema = new mongoose.Schema({
  actionId: { type: String, required: true },
  cashItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CashItem', required: true },
  type: { type: String, enum: ['accelerate_collection', 'defer_payable', 'delay_expense'], required: true },
  amountPaise: { ...money, min: 1 }, fromDate: dateField, toDate: dateField,
  estimatedCostPaise: { type: Number, default: null, min: 0, validate: value => value == null || Number.isSafeInteger(value) },
  feeDate: { type: String, validate: { validator: value => !value || isDateOnly(value) } },
  status: { type: String, enum: ['proposed', 'requested', 'agreed', 'rejected', 'completed'], default: 'proposed' },
  ownerNotes: { type: String, default: '' },
  promiseId: { type: String, default: null },
  baselineSettledPaise: { type: Number, min: 0, validate: Number.isSafeInteger },
  history: { type: [{ at: Date, asOfDate: String, fromStatus: String, toStatus: String, ownerNotes: String, promiseId: String }], default: [] },
}, { _id: false });

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  asOfDate: dateField,
  objective: { type: String, enum: ['nonnegative', 'minimum_reserve'], required: true },
  status: { type: String, enum: ['proposed', 'in_progress', 'completed', 'abandoned'], default: 'proposed' },
  baselineWorstCashPaise: { type: Number, required: true, validate: Number.isSafeInteger },
  simulatedWorstCashPaise: { type: Number, required: true, validate: Number.isSafeInteger },
  estimatedTotalCostPaise: { type: Number, default: null, min: 0, validate: value => value == null || Number.isSafeInteger(value) },
  containsUnknownCosts: { type: Boolean, required: true },
  feasibility: { type: String, enum: ['conditional', 'insufficient'], required: true },
  actions: { type: [actionSchema], default: [] },
  planWarnings: { type: [String], default: [] },
}, { timestamps: true });
schema.index({ workspaceId: 1, createdAt: -1 });
schema.path('estimatedTotalCostPaise').validate(function (value) {
  return !this.containsUnknownCosts || value == null;
}, 'Unknown action costs require a null total');

export default mongoose.model('RescuePlan', schema);
