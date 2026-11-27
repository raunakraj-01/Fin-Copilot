import 'dotenv/config';
import mongoose from 'mongoose';
import Workspace from '../src/models/Workspace.js';
import User from '../src/models/User.js';

const email = (process.env.SEED_OWNER_EMAIL || process.argv[2] || '').trim().toLowerCase();
if (!email) throw new Error('Set SEED_OWNER_EMAIL or pass an email argument');
await mongoose.connect(process.env.MONGODB_URI);
const user = await User.findOne({ email }).lean();
if (!user) throw new Error(`User not found: ${email}`);
console.log('User found:', user?.email, 'ID:', user?._id);

const workspaces = await Workspace.find({
  $or: [{ ownerUserId: user._id }, { 'members.userId': user._id }]
}).sort({ createdAt: -1 }).lean();

console.log(`\nFound ${workspaces.length} workspace(s) for ${user?.email}:`);
for (const w of workspaces) {
  console.log(`- ID: ${w._id} | Name: "${w.name}" | As-Of: ${w.asOfDate} | Cash: ₹${(w.openingCashPaise/100).toLocaleString('en-IN')}`);
}

await mongoose.disconnect();
