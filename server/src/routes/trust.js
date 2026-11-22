import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validate, workspaceOr404 } from '../utils/http.js';
import { requireOwner } from '../middleware/auth.js';
import AuditEvent from '../models/AuditEvent.js';
import BankTransaction from '../models/BankTransaction.js';
import CashItem from '../models/CashItem.js';
import CollectionAction from '../models/CollectionAction.js';
import CollectionFollowUp from '../models/CollectionFollowUp.js';
import ImportBatch from '../models/ImportBatch.js';
import PaymentObservation from '../models/PaymentObservation.js';
import RecurringRule from '../models/RecurringRule.js';
import SyncBatch from '../models/SyncBatch.js';
import SyncDevice from '../models/SyncDevice.js';
import SyncRun from '../models/SyncRun.js';
import Workspace from '../models/Workspace.js';
import { appendAudit } from '../services/audit.js';

const router = Router({ mergeParams: true });
router.use((req, _res, next) => { requireOwner(req); next(); });
router.get('/audit', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const offset = validate(z.coerce.number().int().min(0).max(1000000), req.query.offset ?? 0);
  const [events, total] = await Promise.all([
    AuditEvent.find({ workspaceId: req.params.workspaceId }).sort({ at: -1, _id: -1 }).skip(offset).limit(100).lean(),
    AuditEvent.countDocuments({ workspaceId: req.params.workspaceId }),
  ]);
  res.json({ events, offset, limit: 100, total });
}));
router.get('/export', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  const workspaceData = workspace.toObject();
  delete workspaceData.invitations;
  const [cashItems, recurringRules, bankTransactions, importBatches, followUps, collectionActions, syncBatches, syncRuns, audit, observations] = await Promise.all([
    CashItem.find({ workspaceId: workspace._id }).lean(), RecurringRule.find({ workspaceId: workspace._id }).lean(),
    BankTransaction.find({ workspaceId: workspace._id }).lean(), ImportBatch.find({ workspaceId: workspace._id }).lean(),
    CollectionFollowUp.find({ workspaceId: workspace._id }).lean(), CollectionAction.find({ workspaceId: workspace._id }).lean(),
    SyncBatch.find({ workspaceId: workspace._id }).lean(), SyncRun.find({ workspaceId: workspace._id }).lean(),
    AuditEvent.find({ workspaceId: workspace._id }).sort({ at: 1 }).lean(),
    PaymentObservation.find({ workspaceId: workspace._id }).lean(),
  ]);
  await appendAudit({ workspaceId: workspace._id, userId: req.user._id, action: 'GET trust/export', entityType: 'export', entityId: String(workspace._id) });
  res.set('Content-Disposition', `attachment; filename="cashflow-${workspace._id}-export.json"`);
  res.json({ exportedAt: new Date().toISOString(), formatVersion: 1, workspace: workspaceData,
    cashItems, recurringRules, bankTransactions, importBatches, followUps, collectionActions, syncBatches, syncRuns, audit, observations });
}));
export default router;
