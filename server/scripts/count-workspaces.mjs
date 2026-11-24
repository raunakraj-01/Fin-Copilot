import 'dotenv/config';
import mongoose from 'mongoose';
import Workspace from '../src/models/Workspace.js';
import User from '../src/models/User.js';

await mongoose.connect(process.env.MONGODB_URI);
const user = await User.findOne({ email: 'satviktripathi.cs25@rvce.edu.in' }).lean();

const all = await Workspace.find().sort({ createdAt: -1 }).lean();
const userWs = all.filter(w =>
  String(w.ownerUserId) === String(user?._id) ||
  w.members?.some(m => String(m.userId) === String(user?._id))
);

console.log(`TOTAL_IN_DB:${all.length}`);
console.log(`USER_OWNED:${userWs.length}`);
console.log('\nDETAILS:');
for (const w of all) {
  const isMine = userWs.some(uw => String(uw._id) === String(w._id));
  console.log(`${isMine ? '[YOURS] ' : '[OTHER] '} "${w.name}" (ID: ${w._id}) - Opening Cash: ₹${((w.openingCashPaise || 0) / 100).toLocaleString('en-IN')}`);
}

await mongoose.disconnect();
