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
  orderValuePaise: money, advancePaise: money,
  advanceDate: dateField, finalCollectionDate: dateField,
  costLines: { type: [costLineSchema], default: [] },
  simulatedMinimumAdvancePaise: { type: Number, default: null, min: 0, validate: value => value == null || Number.isSafeInteger(value) },
  scenarioWarnings: { type: [String], default: [] },
}, { timestamps: true });
schema.pre('validate', function (next) {
  if (this.advancePaise > this.orderValuePaise) this.invalidate('advancePaise', 'Cannot exceed orderValuePaise');
  if (this.simulatedMinimumAdvancePaise != null && this.simulatedMinimumAdvancePaise > this.orderValuePaise) {
    this.invalidate('simulatedMinimumAdvancePaise', 'Cannot exceed orderValuePaise');
  }
  next();
});
schema.index({ workspaceId: 1, createdAt: -1 });

export default mongoose.model('OrderScenario', schema);
