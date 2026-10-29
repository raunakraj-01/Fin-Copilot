import mongoose from 'mongoose';
const schema = new mongoose.Schema({ workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  buyerHash: { type: String, required: true }, supplierHash: { type: String, required: true },
  sourceId: { type: String, required: true }, invoiceDate: { type: String, required: true },
  dueDate: { type: String, required: true }, clearedDate: { type: String, required: true },
  amountPaise: { type: Number, required: true }, source: { type: String, required: true } }, { timestamps: true });
schema.index({ workspaceId: 1, sourceId: 1 }, { unique: true });
schema.index({ buyerHash: 1, clearedDate: -1 });
export default mongoose.model('PaymentObservation', schema);
