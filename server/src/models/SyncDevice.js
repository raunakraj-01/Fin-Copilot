import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  tokenHash: { type: String, required: true, unique: true },
  tokenPrefix: { type: String, required: true },
  revokedAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('SyncDevice', schema);
