import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';
const allocation = new mongoose.Schema({
  requestId: { type: String, required: true }, cashItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }, promiseId: { type: String, default: null },
  direction: { type: String, enum: ['credit', 'debit'], default: 'credit' },
  status: { type: String, enum: ['pending', 'applied', 'rejected'], required: true }, error: String, at: Date,
}, { _id: false });
const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true }, importBatchId: mongoose.Schema.Types.ObjectId,
  accountKey: { type: String, required: true }, transactionId: { type: String, required: true }, identity: { type: String, required: true },
  date: { type: String, required: true, validate: isDateOnly }, description: { type: String, default: '' },
  creditPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  debitPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  reviewState: { type: String, enum: ['open', 'excluded'], default: 'open' },
  reviewNote: String, reviewHistory: [{ at: Date, state: String, note: String }],
  allocations: { type: [allocation], default: [] }, version: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ workspaceId: 1, identity: 1 }, { unique: true });
schema.index({ workspaceId: 1, date: -1 });
export default mongoose.model('BankTransaction', schema);
