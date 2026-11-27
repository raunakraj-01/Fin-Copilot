import { Router } from 'express';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { requireSession, requireOwner } from '../middleware/auth.js';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { emailInput } from './auth.js';
import { tokenHash, clientOrigin } from '../services/auth.js';
import User from '../models/User.js';
import { readFile } from 'node:fs/promises';
import CashItem from '../models/CashItem.js';
import { parseUpload, suggestMapping } from '../services/imports/parse.js';
import { normalizeRows } from '../services/imports/normalize.js';
import { workspaceCreate, workspacePatch } from '../validators/finance.js';
import Workspace from '../models/Workspace.js';
import { appendAudit } from '../services/audit.js';
import { provisionDemoWorkspace } from '../services/demo/seedDemoWorkspace.js';

const router = Router();
const shape = workspace => ({ id: String(workspace._id), name: workspace.name, asOfDate: workspace.asOfDate,
  openingCashPaise: workspace.openingCashPaise, minimumReservePaise: workspace.minimumReservePaise,
  businessGstin: workspace.businessGstin || '', sharePaymentTelemetry: workspace.sharePaymentTelemetry === true,
  isDemo: workspace.isDemo === true });
router.get('/', requireSession, asyncRoute(async (req, res) => {
  const workspaces = await Workspace.find({ $or: [{ ownerUserId: req.user._id }, { 'members.userId': req.user._id }] }).sort({ createdAt: 1 });
  res.json({ workspaces: workspaces.map(w => ({ ...shape(w), role: String(w.ownerUserId) === String(req.user._id) ? 'owner' : 'accountant' })) });
}));

export const demoWorkspaceRoute = [requireSession, asyncRoute(async (req, res) => {
  const { reset = false } = validate(z.object({ reset: z.boolean().optional() }).strict(), req.body ?? {});
  const { workspace, created, reset: wasReset } = await provisionDemoWorkspace(req.user._id, { reset });
  res.status(created ? 201 : 200).json({ workspace: { ...shape(workspace), role: 'owner' }, created, reset: wasReset });
})];

router.post('/demo', ...demoWorkspaceRoute);

router.post('/', requireSession, asyncRoute(async (req, res) => {
  const workspace = await Workspace.create({ ...validate(workspaceCreate, req.body), ownerUserId: req.user._id });
  await appendAudit({ workspaceId: workspace._id, userId: req.user._id, action: 'workspace.created', entityType: 'workspace', entityId: String(workspace._id), changedFields: Object.keys(req.body || {}) });
  res.status(201).json({ workspace: { ...shape(workspace), role: 'owner' } });
}));
router.get('/:workspaceId', asyncRoute(async (req, res) => {
  res.json({ workspace: { ...shape(await workspaceOr404(req.params.workspaceId)), role: req.businessRole } });
}));
router.patch('/:workspaceId', requireOwner, asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  Object.assign(workspace, validate(workspacePatch, req.body));
  await workspace.save();
  res.json({ workspace: { ...shape(workspace), role: req.businessRole } });
}));

router.get('/:workspaceId/members', requireOwner, asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  const users = await User.find({ _id: { $in: [workspace.ownerUserId, ...workspace.members.map(m => m.userId)] } }).select('name email').lean();
  res.json({ members: users.map(u => ({ id: String(u._id), name: u.name, email: u.email, role: String(u._id) === String(workspace.ownerUserId) ? 'owner' : 'accountant' })),
    invitations: workspace.invitations.filter(i => i.expiresAt > new Date()).map(i => ({ id: String(i._id), email: i.email, expiresAt: i.expiresAt })) });
}));
router.post('/:workspaceId/demo-data', requireOwner, asyncRoute(async (req, res) => {
  validate(z.object({}).strict(), req.body);
  if (await CashItem.exists({ workspaceId: req.params.workspaceId })) fail(409, 'CONFLICT', 'Load demo records only into an empty business');
  for (const [name, kind] of [['receivables.csv', 'receivables'], ['payables.csv', 'payables']]) {
    const parsed = await parseUpload({ originalname: name, buffer: await readFile(new URL(`../../../fixtures/${name}`, import.meta.url)) });
    for (const row of normalizeRows(parsed.rawRows, suggestMapping(parsed.headers), kind, 'csv')) {
      if (row.state !== 'accepted') fail(500, 'INVALID_FIXTURE', 'Demo records are invalid');
      await CashItem.updateOne({ workspaceId: req.params.workspaceId, category: row.item.category, sourceSystem: row.item.sourceSystem, externalId: row.item.externalId },
        { $setOnInsert: { ...row.item, workspaceId: req.params.workspaceId } }, { upsert: true });
    }
  }
  res.status(201).json({ loaded: true });
}));
router.post('/:workspaceId/members/invitations', requireOwner, asyncRoute(async (req, res) => {
  const { email } = validate(z.object({ email: emailInput }).strict(), req.body);
  if (email === req.user.email) fail(400, 'VALIDATION_ERROR', 'The owner already has access');
  await Workspace.updateOne({ _id: req.params.workspaceId, ownerUserId: req.user._id }, { $pull: { invitations: { $or: [{ email }, { expiresAt: { $lte: new Date() } }] } } });
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const workspace = await Workspace.findOneAndUpdate({ _id: req.params.workspaceId, ownerUserId: req.user._id,
    'invitations.49': { $exists: false }, 'members.49': { $exists: false } }, { $push: { invitations: { email, tokenHash: tokenHash(token), expiresAt } } }, { new: true });
  if (!workspace) fail(409, 'CONFLICT', 'Business access changed or the membership limit was reached');
  res.status(201).json({ email, expiresAt, invitationUrl: `${clientOrigin()}/?invite=${token}` });
}));
router.delete('/:workspaceId/members/:userId', requireOwner, asyncRoute(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.userId)) fail(404, 'NOT_FOUND', 'Member not found');
  const removed = await Workspace.updateOne({ _id: req.params.workspaceId, ownerUserId: req.user._id, 'members.userId': req.params.userId }, { $pull: { members: { userId: req.params.userId } } });
  if (!removed.modifiedCount) fail(404, 'NOT_FOUND', 'Member not found'); res.status(204).end();
}));
router.delete('/:workspaceId/invitations/:invitationId', requireOwner, asyncRoute(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.invitationId)) fail(404, 'NOT_FOUND', 'Invitation not found');
  await Workspace.updateOne({ _id: req.params.workspaceId, ownerUserId: req.user._id }, { $pull: { invitations: { _id: req.params.invitationId } } }); res.status(204).end();
}));

export default router;
