import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';

const dateField = { type: String, required: true, validate: isDateOnly };
const money = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
const costLineSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true },
  amountPaise: money, paymentDate: dateField,
}, { _id: false });

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  label: { type: String, required: true, trim: true },
  orderValuePaise: { ...money, min: 1 }, advancePaise: money,
  advanceDate: dateField, finalCollectionDate: dateField,
  costLines: { type: [costLineSchema], default: [] },
  delayedCollectionDays: { type: Number, default: 0, min: 0, max: 366, validate: Number.isInteger },
  analyzedAt: Date,
  analysisContext: { version: Number, fingerprint: String, asOfDate: String, minimumReservePaise: Number, horizonDays: Number },
  analysisHistory: { type: [{ analyzedAt: Date, minimumAdvancePaise: Number, analysisContext: {
    version: Number, fingerprint: String, asOfDate: String, minimumReservePaise: Number, horizonDays: Number,
  } }], default: [] },
  simulatedMinimumAdvancePaise: { type: Number, default: null, min: 0, validate: value => value == null || Number.isSafeInteger(value) },
  scenarioWarnings: { type: [String], default: [] },
}, { timestamps: true });
schema.path('advancePaise').validate(function (value) {
  return this.orderValuePaise == null || value <= this.orderValuePaise;
}, 'Cannot exceed orderValuePaise');
schema.path('simulatedMinimumAdvancePaise').validate(function (value) {
  return value == null || this.orderValuePaise == null || value <= this.orderValuePaise;
}, 'Cannot exceed orderValuePaise');
schema.index({ workspaceId: 1, createdAt: -1 });

export default mongoose.model('OrderScenario', schema);
