import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';

const schema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  members: { type: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, role: { type: String, enum: ['accountant'], required: true }, addedAt: Date }], default: [] },
  invitations: { type: [{ email: String, tokenHash: String, expiresAt: Date }], default: [] },
  name: { type: String, required: true, trim: true },
  asOfDate: { type: String, required: true, validate: isDateOnly },
  openingCashPaise: { type: Number, required: true, validate: Number.isSafeInteger },
  minimumReservePaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  currency: { type: String, default: 'INR', immutable: true },
  mode: { type: String, default: 'demo', immutable: true },
  businessGstin: { type: String, uppercase: true, trim: true,
    match: /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/ },
  sharePaymentTelemetry: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ 'members.userId': 1 });

export default mongoose.model('Workspace', schema);
