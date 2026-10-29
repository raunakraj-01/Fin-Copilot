import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  cashItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  grossPaise: { type: Number, required: true },
  buyerPaysPaise: { type: Number, required: true },
  discountPaise: { type: Number, required: true },
  settleBy: { type: String, required: true },
  referenceId: { type: String, required: true, unique: true },
  gatewayLinkId: { type: String, unique: true, sparse: true },
  paymentUrl: String,
  status: { type: String, enum: ['creating', 'created', 'paid'], default: 'creating' },
  paidAt: String,
}, { timestamps: true });

export default mongoose.model('PaymentOffer', schema);
