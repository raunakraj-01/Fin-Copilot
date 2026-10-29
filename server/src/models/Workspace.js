import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  asOfDate: { type: String, required: true, validate: isDateOnly },
  openingCashPaise: { type: Number, required: true, validate: Number.isSafeInteger },
  minimumReservePaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  currency: { type: String, default: 'INR', immutable: true },
  mode: { type: String, default: 'demo', immutable: true },
  sharePaymentTelemetry: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('Workspace', schema);
