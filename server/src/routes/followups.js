import { Router } from 'express';
import { z } from 'zod';
import { createHash, timingSafeEqual } from 'node:crypto';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { requireOwner } from './offers.js';
import CollectionFollowUp from '../models/CollectionFollowUp.js';
import { loadDecisionContext } from '../services/rescue/decisionContext.js';
import { eligible, recommendCollections, liveFollowupsEnabled, runFollowups, validateDispatch, finishFollowup } from '../services/finance/followups.js';

const id = z.string().regex(/^[a-f\d]{24}$/i);
const router = Router({ mergeParams: true });
router.use((req, _res, next) => {
  Promise.resolve().then(async () => { requireOwner(req); await workspaceOr404(req.params.workspaceId); next(); }).catch(next);
});
router.get('/', asyncRoute(async (req, res) => {
  const context = await loadDecisionContext(req.params.workspaceId);
  const rules = await CollectionFollowUp.find({ workspaceId: req.params.workspaceId }).sort({ createdAt: -1 }).lean();
  res.json({ ...recommendCollections(context), liveEnabled: liveFollowupsEnabled(), receivables: context.cashItems.filter(eligible).map(item => ({ id: item.id, externalId: item.externalId, counterparty: item.counterparty })), rules: rules.map(rule => ({ ...rule,
    id: String(rule._id), counterparty: context.cashItems.find(item => item.id === String(rule.cashItemId))?.counterparty || 'Unavailable invoice',
    externalId: context.cashItems.find(item => item.id === String(rule.cashItemId))?.externalId })) });
}));
router.post('/', asyncRoute(async (req, res) => {
  const data = validate(z.object({ cashItemId: id, phone: z.string().regex(/^\+?\d{10,15}$/).transform(v => v.replace(/^\+/, '')),
    mode: z.enum(['demo', 'n8n']).default('demo'), recipientOptIn: z.boolean().default(false),
    cadenceDays: z.number().int().min(1).max(30).default(3), maxAttempts: z.number().int().min(1).max(5).default(3) }).strict(), req.body);
  if (data.mode === 'n8n' && (!liveFollowupsEnabled() || !data.recipientOptIn)) fail(400, 'LIVE_DISABLED', 'Live sending needs server configuration and recipient opt-in');
  const context = await loadDecisionContext(req.params.workspaceId);
  if (!eligible(context.cashItems.find(item => item.id === data.cashItemId))) fail(400, 'INELIGIBLE', 'Choose a verified open receivable with an outstanding balance');
  const prior = await CollectionFollowUp.findOne({ workspaceId: req.params.workspaceId, cashItemId: data.cashItemId });
  if (prior?.claimId) fail(409, 'IN_PROGRESS', 'A send is in progress. Check its result before changing the schedule.');
  const rule = await CollectionFollowUp.findOneAndUpdate({ workspaceId: req.params.workspaceId, cashItemId: data.cashItemId, claimId: null },
    { $set: { ...data, state: 'active', attempts: 0, nextRunAt: new Date(), lastOutcome: 'Scheduled', claimId: null } }, { upsert: true, new: true, runValidators: true });
  res.status(201).json({ rule });
}));
router.patch('/:ruleId', asyncRoute(async (req, res) => {
  const ruleId = validate(id, req.params.ruleId);
  validate(z.object({ state: z.literal('paused') }).strict(), req.body);
  const rule = await CollectionFollowUp.findOneAndUpdate({ _id: ruleId, workspaceId: req.params.workspaceId }, { $set: { state: 'paused' } }, { new: true });
  if (!rule) fail(404, 'NOT_FOUND', 'Follow-up not found');
  res.json({ rule });
}));
router.post('/:ruleId/demo-run', asyncRoute(async (req, res) => {
  const ruleId = validate(id, req.params.ruleId);
  const rule = await CollectionFollowUp.findOne({ _id: ruleId, workspaceId: req.params.workspaceId, mode: 'demo', state: 'active', claimId: null });
  if (!rule) fail(400, 'NOT_ACTIVE', 'Choose an active demo follow-up');
  await CollectionFollowUp.updateOne({ _id: rule._id, claimId: null, state: 'active' }, { $set: { nextRunAt: new Date() } });
  await runFollowups({ workspaceId: req.params.workspaceId, ruleId });
  res.json({ message: 'Demo cycle checked. Only a local draft can be generated; no WhatsApp API is called.' });
}));
export default router;

export const automationRouter = Router();
automationRouter.use((req, _res, next) => {
  const token = process.env.FOLLOWUP_AUTOMATION_TOKEN;
  const hash = value => createHash('sha256').update(value).digest();
  if (!token || !timingSafeEqual(hash(req.get('Authorization') || ''), hash(`Bearer ${token}`))) return next(Object.assign(new Error('Automation authorization required'), { status: 401, code: 'UNAUTHORIZED' }));
  if (!liveFollowupsEnabled()) return next(Object.assign(new Error('Live follow-ups are disabled'), { status: 503, code: 'LIVE_DISABLED' }));
  next();
});
automationRouter.post('/claim', asyncRoute(async (_req, res) => { res.json({ jobs: await runFollowups({ mode: 'n8n' }) }); }));
automationRouter.post('/jobs/:claimId/validate', asyncRoute(async (req, res) => {
  const claimId = validate(z.string().uuid(), req.params.claimId);
  const job = await validateDispatch(claimId);
  res.json({ send: Boolean(job), ...job });
}));
automationRouter.post('/jobs/:claimId/ack', asyncRoute(async (req, res) => {
  const claimId = validate(z.string().uuid(), req.params.claimId);
  const data = validate(z.object({ outcome: z.enum(['accepted', 'failed']), providerMessageId: z.string().max(300).optional() }).strict(), req.body);
  if (data.outcome === 'accepted' && !data.providerMessageId) fail(400, 'INVALID_ACK', 'Accepted sends need the provider message ID');
  const rule = await finishFollowup(claimId, data.outcome, data.providerMessageId);
  res.json({ recorded: Boolean(rule) });
}));
