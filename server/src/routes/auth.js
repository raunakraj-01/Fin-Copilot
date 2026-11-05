import { Router } from 'express';
import { z } from 'zod';
import User from '../models/User.js';
import AuthSession from '../models/AuthSession.js';
import Workspace from '../models/Workspace.js';
import { asyncRoute, fail, validate } from '../utils/http.js';
import { requireSession } from '../middleware/auth.js';
import { assertOrigin, cookieName, createSession, hashPassword, verifyPassword, throttle, tokenHash } from '../services/auth.js';
const router = Router();
export const emailInput = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(15).max(128);
const userShape = user => ({ id: String(user._id), email: user.email, name: user.name });
router.post('/register', asyncRoute(async (req, res) => {
  assertOrigin(req);
  const data = validate(z.object({ name: z.string().trim().min(1).max(100), email: emailInput, password }).strict(), req.body);
  await throttle(req, 'register');
  await User.init();
  const passwordHash = await hashPassword(data.password);
  let user;
  try { user = await User.create({ name: data.name, email: data.email, passwordHash }); }
  catch (error) { if (error.code === 11000) fail(409, 'CONFLICT', 'Unable to create an account with these details'); throw error; }
  const csrfToken = await createSession(user, res);
  res.status(201).json({ user: userShape(user), csrfToken });
}));
router.post('/login', asyncRoute(async (req, res) => {
  assertOrigin(req);
  const data = validate(z.object({ email: emailInput, password: z.string().min(1).max(128) }).strict(), req.body);
  await throttle(req, 'login', data.email);
  const user = await User.findOne({ email: data.email }).select('+passwordHash');
  const correct = await verifyPassword(data.password, user?.passwordHash);
  if (!correct || user.disabled) fail(401, 'UNAUTHORIZED', 'Email or password is incorrect');
  // A login always issues a new unpredictable token, never accepts a supplied session.
  const csrfToken = await createSession(user, res);
  res.json({ user: userShape(user), csrfToken });
}));
router.get('/me', requireSession, (req, res) => res.json({ user: userShape(req.user), csrfToken: req.csrfToken }));
router.post('/logout', requireSession, asyncRoute(async (req, res) => {
  await AuthSession.deleteOne({ _id: req.session._id });
  res.clearCookie(cookieName(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' }); res.status(204).end();
}));
router.post('/password', requireSession, asyncRoute(async (req, res) => {
  const data = validate(z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict(), req.body);
  await throttle(req, 'password', req.user.email);
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!await verifyPassword(data.currentPassword, user.passwordHash)) fail(401, 'UNAUTHORIZED', 'Current password is incorrect');
  const updated = await User.findOneAndUpdate({ _id: user._id, authVersion: user.authVersion }, { $set: { passwordHash: await hashPassword(data.newPassword) }, $inc: { authVersion: 1 } }, { new: true });
  if (!updated) fail(409, 'CONFLICT', 'Account changed. Sign in again.');
  await AuthSession.deleteMany({ userId: user._id });
  res.json({ user: userShape(updated), csrfToken: await createSession(updated, res) });
}));
router.post('/invitations/accept', requireSession, asyncRoute(async (req, res) => {
  const { token } = validate(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), req.body);
  const workspace = await Workspace.findOneAndUpdate({ invitations: { $elemMatch: { tokenHash: tokenHash(token), email: req.user.email, expiresAt: { $gt: new Date() } } },
    ownerUserId: { $exists: true, $nin: [null, req.user._id] }, 'members.userId': { $ne: req.user._id }, 'members.49': { $exists: false } }, {
    $push: { members: { userId: req.user._id, role: 'accountant', addedAt: new Date() } }, $pull: { invitations: { email: req.user.email } },
  }, { new: true });
  if (!workspace) fail(400, 'INVALID_INVITATION', 'Invitation is invalid, expired, already used or belongs to a different email');
  res.json({ workspaceId: String(workspace._id), role: 'accountant' });
}));
export default router;
