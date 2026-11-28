import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import User from '../models/User.js';
import AuthSession from '../models/AuthSession.js';
import Workspace from '../models/Workspace.js';
import { asyncRoute, fail, validate } from '../utils/http.js';
import { requireSession } from '../middleware/auth.js';
import { assertOrigin, checkAuthThrottle, clearAuthAttempts, cookieName, createSession, hashPassword, recordAuthAttempt, tokenHash, verifyPassword } from '../services/auth.js';
import { appendSecurityEvent } from '../services/audit.js';
import { purgeWorkspaceData } from '../services/demo/seedDemoWorkspace.js';
const router = Router();
export const emailInput = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(128);
const userShape = user => ({ id: String(user._id), email: user.email, name: user.name });
router.post('/register', asyncRoute(async (req, res) => {
  assertOrigin(req);
  const data = validate(z.object({ name: z.string().trim().min(1).max(100), email: emailInput, password }).strict(), req.body);
  await checkAuthThrottle(req, res, 'register', data.email);
  await recordAuthAttempt(req, res, 'register', data.email);
  await User.init();
  const passwordHash = await hashPassword(data.password);
  let user;
  try { user = await User.create({ name: data.name, email: data.email, passwordHash }); }
  catch (error) {
    if (error.code === 11000) {
      await appendSecurityEvent({ action: 'auth.register', outcome: 'failed', ip: req.ip, details: ['duplicate'] });
      fail(409, 'CONFLICT', 'Unable to create an account with these details');
    }
    throw error;
  }
  await appendSecurityEvent({ action: 'auth.register', outcome: 'succeeded', actorUserId: user._id, ip: req.ip });
  const csrfToken = await createSession(user, res);
  res.status(201).json({ user: userShape(user), csrfToken });
}));
router.post('/login', asyncRoute(async (req, res) => {
  assertOrigin(req);
  const data = validate(z.object({ email: emailInput, password: z.string().min(1).max(128) }).strict(), req.body);
  await checkAuthThrottle(req, res, 'login', data.email);
  const user = await User.findOne({ email: data.email }).select('+passwordHash');
  const correct = await verifyPassword(data.password, user?.passwordHash);
  if (!correct || user.disabled) {
    await recordAuthAttempt(req, res, 'login', data.email);
    await appendSecurityEvent({ action: 'auth.login', outcome: 'failed', actorUserId: user?._id || null, ip: req.ip });
    fail(401, 'UNAUTHORIZED', 'Email or password is incorrect');
  }
  await clearAuthAttempts('login', data.email);
  await appendSecurityEvent({ action: 'auth.login', outcome: 'succeeded', actorUserId: user._id, ip: req.ip });
  // A login always issues a new unpredictable token, never accepts a supplied session.
  const csrfToken = await createSession(user, res);
  res.json({ user: userShape(user), csrfToken });
}));
router.get('/me', requireSession, (req, res) => res.json({ user: userShape(req.user), csrfToken: req.csrfToken }));
router.post('/logout', requireSession, asyncRoute(async (req, res) => {
  await AuthSession.deleteOne({ _id: req.session._id });
  await appendSecurityEvent({ action: 'auth.logout', outcome: 'succeeded', actorUserId: req.user._id, ip: req.ip });
  res.clearCookie(cookieName(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' }); res.status(204).end();
}));
router.post('/password', requireSession, asyncRoute(async (req, res) => {
  const data = validate(z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict(), req.body);
  await checkAuthThrottle(req, res, 'password', req.user.email);
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!await verifyPassword(data.currentPassword, user.passwordHash)) {
    await recordAuthAttempt(req, res, 'password', req.user.email);
    await appendSecurityEvent({ action: 'auth.password_changed', outcome: 'failed', actorUserId: req.user._id, ip: req.ip });
    fail(401, 'UNAUTHORIZED', 'Current password is incorrect');
  }
  await clearAuthAttempts('password', req.user.email);
  const updated = await User.findOneAndUpdate({ _id: user._id, authVersion: user.authVersion }, { $set: { passwordHash: await hashPassword(data.newPassword) }, $inc: { authVersion: 1 } }, { new: true });
  if (!updated) fail(409, 'CONFLICT', 'Account changed. Sign in again.');
  await AuthSession.deleteMany({ userId: user._id });
  await appendSecurityEvent({ action: 'auth.password_changed', outcome: 'succeeded', actorUserId: updated._id, ip: req.ip });
  res.json({ user: userShape(updated), csrfToken: await createSession(updated, res) });
}));
router.post('/recovery-codes', requireSession, asyncRoute(async (req, res) => {
  const { currentPassword } = validate(z.object({ currentPassword: z.string().min(1).max(128) }).strict(), req.body);
  await checkAuthThrottle(req, res, 'recovery-codes', req.user.email);
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!await verifyPassword(currentPassword, user.passwordHash)) {
    await recordAuthAttempt(req, res, 'recovery-codes', req.user.email);
    await appendSecurityEvent({ action: 'auth.recovery_codes_generated', outcome: 'failed', actorUserId: req.user._id, ip: req.ip });
    fail(401, 'UNAUTHORIZED', 'Current password is incorrect');
  }
  await clearAuthAttempts('recovery-codes', req.user.email);
  const codes = Array.from({ length: 10 }, () => randomBytes(8).toString('hex').toUpperCase());
  user.recoveryCodeHashes = codes.map(code => ({ hash: tokenHash(code), createdAt: new Date() }));
  await user.save();
  await appendSecurityEvent({ action: 'auth.recovery_codes_generated', outcome: 'succeeded', actorUserId: user._id, ip: req.ip });
  res.json({ codes, createdAt: user.recoveryCodeHashes[0].createdAt });
}));
router.post('/recover', asyncRoute(async (req, res) => {
  assertOrigin(req);
  const data = validate(z.object({ email: emailInput, recoveryCode: z.string().trim().min(8).max(40), newPassword: password }).strict(), req.body);
  await checkAuthThrottle(req, res, 'recover', data.email);
  const normalizedCode = data.recoveryCode.replace(/[^a-f\d]/gi, '').toUpperCase();
  const hash = tokenHash(normalizedCode);
  const user = await User.findOneAndUpdate({ email: data.email, disabled: false,
    recoveryCodeHashes: { $elemMatch: { hash, usedAt: null } } },
  { $set: { 'recoveryCodeHashes.$.usedAt': new Date(), passwordHash: await hashPassword(data.newPassword) }, $inc: { authVersion: 1 } }, { new: true });
  if (!user) {
    await recordAuthAttempt(req, res, 'recover', data.email);
    await appendSecurityEvent({ action: 'auth.account_recovered', outcome: 'failed', ip: req.ip });
    fail(400, 'RECOVERY_FAILED', 'Email or recovery code is invalid, expired, or already used');
  }
  await clearAuthAttempts('recover', data.email);
  await AuthSession.deleteMany({ userId: user._id });
  await appendSecurityEvent({ action: 'auth.account_recovered', outcome: 'succeeded', actorUserId: user._id, ip: req.ip });
  res.json({ recovered: true, message: 'Password changed. Sign in with your new password.' });
}));
router.post('/invitations/accept', requireSession, asyncRoute(async (req, res) => {
  const { token } = validate(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), req.body);
  const workspace = await Workspace.findOneAndUpdate({ invitations: { $elemMatch: { tokenHash: tokenHash(token), email: req.user.email, expiresAt: { $gt: new Date() } } },
    ownerUserId: { $exists: true, $nin: [null, req.user._id] }, 'members.userId': { $ne: req.user._id }, 'members.49': { $exists: false } }, {
    $push: { members: { userId: req.user._id, role: 'accountant', addedAt: new Date() } }, $pull: { invitations: { email: req.user.email } },
  }, { new: true });
  if (!workspace) fail(400, 'INVALID_INVITATION', 'Invitation is invalid, expired, already used or belongs to a different email');
  await appendSecurityEvent({ action: 'auth.invitation_accepted', outcome: 'succeeded', actorUserId: req.user._id, workspaceId: workspace._id, ip: req.ip });
  res.json({ workspaceId: String(workspace._id), role: 'accountant' });
}));
router.delete('/account', requireSession, asyncRoute(async (req, res) => {
  const { currentPassword } = validate(z.object({ currentPassword: z.string().min(1).max(128) }).strict(), req.body);
  await checkAuthThrottle(req, res, 'password', req.user.email);
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!user || !await verifyPassword(currentPassword, user.passwordHash)) {
    await recordAuthAttempt(req, res, 'password', req.user.email);
    await appendSecurityEvent({ action: 'auth.account_deleted', outcome: 'failed', actorUserId: req.user._id, ip: req.ip });
    fail(401, 'UNAUTHORIZED', 'Current password is incorrect');
  }
  await clearAuthAttempts('password', req.user.email);
  const owned = await Workspace.find({ ownerUserId: user._id }).select('_id').lean();
  for (const ws of owned) {
    await purgeWorkspaceData(ws._id, { includeDevicesAndTelemetry: true });
  }
  await Workspace.deleteMany({ ownerUserId: user._id });
  await Workspace.updateMany({ 'members.userId': user._id }, { $pull: { members: { userId: user._id } } });
  await Workspace.updateMany({ 'invitations.email': user.email }, { $pull: { invitations: { email: user.email } } });
  await AuthSession.deleteMany({ userId: user._id });
  await User.deleteOne({ _id: user._id });
  await appendSecurityEvent({ action: 'auth.account_deleted', outcome: 'succeeded', actorUserId: user._id, ip: req.ip, details: [`owned:${owned.length}`] });
  res.clearCookie(cookieName(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
  res.status(204).end();
}));
export default router;
