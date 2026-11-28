import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  action: { type: String, required: true, maxlength: 80 },
  outcome: { type: String, enum: ['succeeded', 'failed'], default: 'succeeded' },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
  ipHash: { type: String, default: '', maxlength: 128 },
  details: { type: [String], default: [] },
  at: { type: Date, default: Date.now, immutable: true },
}, { timestamps: false, strict: true });

schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('Security events are append-only');
});

schema.index({ actorUserId: 1, at: -1 });
schema.index({ action: 1, at: -1 });
schema.index({ at: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

export default mongoose.model('SecurityEvent', schema);
