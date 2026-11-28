import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  telegramUserId: { type: Number, default: null },
  telegramUsername: { type: String, trim: true, maxlength: 100, default: '' },
  firstName: { type: String, trim: true, maxlength: 100, default: '' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  activeWorkspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
  authVersion: { type: Number, required: true, default: 0 },
  linkedAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now },
}, { timestamps: true });

schema.index({ userId: 1, activeWorkspaceId: 1 });

export default mongoose.model('TelegramLink', schema);
