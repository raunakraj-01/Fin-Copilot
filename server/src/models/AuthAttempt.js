import mongoose from 'mongoose';
const schema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, count: Number, expiresAt: Date });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model('AuthAttempt', schema);
