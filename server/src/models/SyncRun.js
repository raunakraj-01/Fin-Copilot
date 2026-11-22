import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'SyncDevice', required: true },
  runId: { type: String, required: true },
  companyId: { type: String, required: true },
  status: { type: String, enum: ['running', 'succeeded', 'failed'], required: true },
  startedAt: { type: Date, required: true }, completedAt: Date,
  pendingCount: { type: Number, default: 0, min: 0 }, appliedCount: { type: Number, default: 0, min: 0 },
  errorCode: { type: String, default: '' }, errorMessage: { type: String, default: '' },
}, { timestamps: true });
schema.index({ workspaceId: 1, deviceId: 1, runId: 1 }, { unique: true });
schema.index({ workspaceId: 1, completedAt: -1 });
export default mongoose.model('SyncRun', schema);
