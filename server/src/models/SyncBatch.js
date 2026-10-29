import mongoose from 'mongoose';
const schema = new mongoose.Schema({ workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  companyId: { type: String, required: true }, batchId: { type: String, required: true }, count: Number,
  observationCount: { type: Number, default: 0 }, deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'SyncDevice', default: null },
}, { timestamps: true });
schema.index({ workspaceId: 1, companyId: 1, batchId: 1 }, { unique: true });
export default mongoose.model('SyncBatch', schema);
