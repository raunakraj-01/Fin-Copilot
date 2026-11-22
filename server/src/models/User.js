import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, maxlength: 100 },
  passwordHash: { type: String, required: true, select: false },
  recoveryCodeHashes: { type: [{ hash: { type: String, required: true }, createdAt: { type: Date, required: true }, usedAt: Date }], default: [], select: false },
  authVersion: { type: Number, default: 0 }, disabled: { type: Boolean, default: false },
}, { timestamps: true });
export default mongoose.model('User', schema);
