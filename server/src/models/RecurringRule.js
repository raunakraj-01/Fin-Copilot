import mongoose from 'mongoose';
import { isDateOnly } from '../utils/dates.js';

const schema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  description: { type: String, required: true }, amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  dayOfMonth: { type: Number, required: true, min: 1, max: 28 },
  startsOn: { type: String, required: true, validate: isDateOnly },
  endsOn: { type: String, default: null, validate: { validator: value => !value || isDateOnly(value) } },
  mandatory: { type: Boolean, default: true }, active: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('RecurringRule', schema);
