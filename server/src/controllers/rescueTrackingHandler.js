import { z } from 'zod';
import { parseRequest, DecisionValidationError } from '../services/rescue/validation.js';
import { persistenceHandler, validateId, notFound, workspaceExists } from './rescuePersistenceHandler.js';

const updateSchema = z.object({
  status: z.enum(['proposed', 'requested', 'agreed', 'rejected', 'completed']).optional(),
  ownerNotes: z.string().max(2000).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Provide a status or owner note');

export function listRescuePlansHandler(dependencies = {}) {
  return persistenceHandler(async (req, res) => {
    if (!await (dependencies.workspaceExists ?? workspaceExists)(req.params.workspaceId)) return notFound(res, 'Workspace not found');
    const listPlans = dependencies.listPlans ?? (async workspaceId => {
      const { default: RescuePlan } = await import('../models/RescuePlan.js');
      return RescuePlan.find({ workspaceId }).sort({ createdAt: -1, _id: -1 }).limit(50).lean();
    });
    res.json({ plans: await listPlans(req.params.workspaceId), limit: 50 });
  }, dependencies);
}

export function updateRescueActionHandler(dependencies = {}) {
  return persistenceHandler(async (req, res) => {
    validateId(req.params.planId, 'planId');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(req.params.actionId ?? '')) throw new DecisionValidationError('Invalid action ID', 'actionId');
    const update = parseRequest(updateSchema, req.body);
    if (!await (dependencies.workspaceExists ?? workspaceExists)(req.params.workspaceId)) return notFound(res, 'Workspace not found');
    const updateAction = dependencies.updateAction ?? (async ({ workspaceId, planId, actionId, update }) => {
      const { default: RescuePlan } = await import('../models/RescuePlan.js');
      const changes = Object.fromEntries(Object.entries(update).map(([field, value]) => [`actions.$.${field}`, value]));
      return RescuePlan.findOneAndUpdate({ _id: planId, workspaceId, 'actions.actionId': actionId }, { $set: changes }, { new: true, runValidators: true }).lean();
    });
    const plan = await updateAction({ ...req.params, update });
    if (!plan) return notFound(res, 'Plan or action not found');
    res.json(plan);
  }, dependencies);
}
