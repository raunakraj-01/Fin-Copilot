import mongoose from 'mongoose';
import { timingSafeEqual } from 'node:crypto';
import AuthSession from '../models/AuthSession.js';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import SyncDevice from '../models/SyncDevice.js';
import { tokenHash, cookieToken, csrfToken, assertOrigin } from '../services/auth.js';
import { asyncRoute, fail } from '../utils/http.js';

export const requireSession = asyncRoute(async (req, _res, next) => {
  const token = cookieToken(req);
  if (!token) fail(401, 'UNAUTHORIZED', 'Sign in to continue');
  const session = await AuthSession.findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } }).lean();
  const user = session && await User.findOne({ _id: session.userId, authVersion: session.authVersion, disabled: false }).lean();
  if (!user) fail(401, 'UNAUTHORIZED', 'Session expired. Sign in again.');
  req.user = user; req.session = session; req.csrfToken = csrfToken(token);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    assertOrigin(req);
    const supplied = req.get('X-CSRF-Token') || '';
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(req.csrfToken, 'hex')))
      fail(403, 'CSRF_REJECTED', 'Reload the page and retry the request');
  }
  next();
});
export function requireOwner(req, _res, next) {
  if (!req.user || req.businessRole !== 'owner') fail(403, 'FORBIDDEN', 'Business owner access required');
  if (next) next();
}
export const requireBusiness = asyncRoute(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.workspaceId)) fail(404, 'NOT_FOUND', 'Business not found');
  const serviceRoute = req.method === 'POST' && ['/sync/batches', '/sync/runs', '/reliability/observations'].includes(req.path);
  if (serviceRoute) {
    const token = req.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
    const device = token && await SyncDevice.findOne({ workspaceId: req.params.workspaceId, tokenHash: tokenHash(token), revokedAt: null, kind: 'sync' }).lean();
    const workspace = device && await Workspace.findOne({ _id: req.params.workspaceId, ownerUserId: { $exists: true, $ne: null } }).lean();
    if (!workspace) fail(401, 'UNAUTHORIZED', 'A valid business-scoped sync credential is required');
    req.service = device; req.businessRole = 'service'; return next();
  }
  // Authentication runs before a business lookup so an unauthenticated caller
  // cannot probe whether a real business ID exists.
  requireSession(req, res, async error => {
    if (error) return next(error);
    try {
      const workspace = await Workspace.findOne({ _id: req.params.workspaceId,
        $or: [{ ownerUserId: req.user._id }, { 'members.userId': req.user._id }] });
      if (!workspace) fail(404, 'NOT_FOUND', 'Business not found');
      req.workspace = workspace;
      req.businessRole = String(workspace.ownerUserId) === String(req.user._id) ? 'owner' : 'accountant';
      if ((req.method === 'DELETE') || (req.method === 'PATCH' && req.path === '/')) requireOwner(req);
      next();
    } catch (cause) { next(cause); }
  });
});
export const requireAutomation = asyncRoute(async (req, _res, next) => {
  const token = req.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  const device = token && await SyncDevice.findOne({ tokenHash: tokenHash(token), revokedAt: null, kind: 'automation' }).lean();
  if (!device || !await Workspace.exists({ _id: device.workspaceId, ownerUserId: { $exists: true, $ne: null } })) fail(401, 'UNAUTHORIZED', 'A valid business-scoped automation credential is required');
  req.service = device; next();
});
