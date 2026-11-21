import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  cashItemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  followUpId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionFollowUp', default: null },
  requestId: { type: String, required: true },
  type: { type: String, enum: ['reminder_draft', 'reminder_sent', 'customer_response', 'promise_created', 'promise_revised', 'promise_cancelled', 'dispute', 'receipt_confirmed'], required: true },
  status: { type: String, enum: ['draft', 'accepted', 'sent', 'delivered', 'read', 'failed', 'recorded'], default: 'recorded' },
  note: { type: String, default: '', maxlength: 2000 },
  amountPaise: { type: Number, min: 0, validate: value => value == null || Number.isSafeInteger(value) },
  promisedDate: String, receivedDate: String, providerMessageId: String,
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  at: { type: Date, default: Date.now },
}, { timestamps: true });
schema.index({ workspaceId: 1, requestId: 1 }, { unique: true });
schema.index({ workspaceId: 1, cashItemId: 1, at: -1 });
export default mongoose.model('CollectionAction', schema);
