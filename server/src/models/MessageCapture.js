import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  sourceSystem: { type: String, enum: ['whatsapp_cloud', 'n8n'], default: 'whatsapp_cloud', required: true },
  sourceMessageId: { type: String, required: true, trim: true, maxlength: 256 },
  senderPhone: { type: String, trim: true, maxlength: 32, default: '' },
  senderName: { type: String, trim: true, maxlength: 160, default: '' },
  rawText: { type: String, required: true, maxlength: 4000 },
  receivedAt: { type: Date, required: true },
  captureType: { type: String, enum: ['order', 'promise', 'unknown'], required: true },
  parseStatus: { type: String, enum: ['ready', 'needs_fields', 'unrecognized'], required: true },
  parseIssues: { type: [String], default: [] },
  proposal: { type: mongoose.Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', required: true },
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
  actionResult: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ workspaceId: 1, status: 1, receivedAt: -1 });
schema.index({ workspaceId: 1, sourceSystem: 1, sourceMessageId: 1 }, { unique: true });

export default mongoose.model('MessageCapture', schema);
