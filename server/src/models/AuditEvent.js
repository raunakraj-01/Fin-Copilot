import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  actorType: { type: String, enum: ['user', 'sync_device', 'automation', 'system'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
  action: { type: String, required: true, maxlength: 160 },
  entityType: { type: String, required: true, maxlength: 80 },
  entityId: { type: String, default: '' },
  changedFields: { type: [String], default: [] },
  outcome: { type: String, enum: ['succeeded'], default: 'succeeded' },
  at: { type: Date, default: Date.now, immutable: true },
}, { timestamps: false, strict: true });
schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('Audit events are append-only');
});
schema.index({ workspaceId: 1, at: -1 });
export default mongoose.model('AuditEvent', schema);
