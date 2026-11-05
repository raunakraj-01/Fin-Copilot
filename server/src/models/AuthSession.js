import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true }, userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  authVersion: { type: Number, required: true }, expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model('AuthSession', schema);
