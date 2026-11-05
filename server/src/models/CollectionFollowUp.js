import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  cashItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  phone: { type: String, required: true },
  mode: { type: String, enum: ['demo', 'n8n'], default: 'demo' },
  recipientOptIn: { type: Boolean, default: false },
  state: { type: String, enum: ['active', 'paused', 'paid', 'exhausted', 'unavailable'], default: 'active' },
  cadenceDays: { type: Number, default: 3, min: 1, max: 30 },
  maxAttempts: { type: Number, default: 3, min: 1, max: 5 },
  attempts: { type: Number, default: 0 },
  nextRunAt: { type: Date, required: true },
  claimId: { type: String, default: null },
  claimedAt: Date,
  dispatchStartedAt: { type: Date, default: null },
  lastMessage: String,
  lastOutcome: String,
  history: { type: [{ at: Date, message: String, outcome: String, providerMessageId: String }], default: [] },
}, { timestamps: true });
schema.index({ workspaceId: 1, cashItemId: 1 }, { unique: true });
schema.index({ state: 1, mode: 1, nextRunAt: 1 });
export default mongoose.model('CollectionFollowUp', schema);
