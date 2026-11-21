import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  companyId: { type: String, required: true }, sourceId: { type: String, required: true }, version: { type: String, required: true },
  batchId: { type: String, required: true }, cashItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
  kind: { type: String, enum: ['changed', 'deleted', 'backdated'], required: true },
  proposedItem: { type: mongoose.Schema.Types.Mixed, default: null },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  state: { type: String, enum: ['pending', 'accepted', 'kept_current'], default: 'pending' },
  resolvedAt: Date, resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });
schema.index({ workspaceId: 1, companyId: 1, sourceId: 1, version: 1 }, { unique: true });
schema.index({ workspaceId: 1, state: 1, createdAt: -1 });
export default mongoose.model('SyncConflict', schema);
