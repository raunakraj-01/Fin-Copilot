import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Workspace from '../src/models/Workspace.js';
import User from '../src/models/User.js';
const [workspaceId, email] = process.argv.slice(2);
if (!mongoose.isValidObjectId(workspaceId) || !email) throw new Error('Usage: node scripts/assign-business-owner.mjs BUSINESS_ID OWNER_EMAIL');
try {
  await connectDb(process.env.MONGODB_URI);
  const user = await User.findOne({ email: email.toLowerCase().trim(), disabled: false });
  if (!user) throw new Error('Register the owner account first');
  const result = await Workspace.updateOne({ _id: workspaceId, ownerUserId: null }, { $set: { ownerUserId: user._id } });
  if (!result.modifiedCount) throw new Error('Business is missing or already has an owner; no ownership was changed');
  console.log('Owner assigned to the existing business.');
} finally { await mongoose.disconnect(); }
