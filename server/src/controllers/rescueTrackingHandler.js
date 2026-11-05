import { z } from 'zod';
import { parseRequest, DecisionValidationError } from '../services/rescue/validation.js';
import { persistenceHandler, validateId, notFound, workspaceExists } from './rescuePersistenceHandler.js';
import { loadDecisionContext } from '../services/rescue/decisionContext.js';
import { evaluatePlan } from '../services/rescue/outcomes.js';

const updateSchema = z.object({
  status: z.enum(['proposed', 'requested', 'agreed', 'rejected', 'completed']).optional(),
  ownerNotes: z.string().max(2000).optional(),
  promiseId: z.string().regex(/^[a-fA-F0-9]{24}$/).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Provide a status or owner note');

export function listRescuePlansHandler(dependencies = {}) {
  return persistenceHandler(async (req, res) => {
    if (!await (dependencies.workspaceExists ?? workspaceExists)(req.params.workspaceId)) return notFound(res, 'Workspace not found');
    const listPlans = dependencies.listPlans ?? (async workspaceId => {
      const { default: RescuePlan } = await import('../models/RescuePlan.js');
      return RescuePlan.find({ workspaceId }).sort({ createdAt: -1, _id: -1 }).limit(50).lean();
    });
    const plans = await listPlans(req.params.workspaceId);
    const context = plans.length ? await (dependencies.loadContext ?? loadDecisionContext)(req.params.workspaceId) : null;
    res.json({ plans: plans.map(plan => ({ ...plan, live: evaluatePlan(context, plan) })), limit: 50 });
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
      const { default: CashItem } = await import('../models/CashItem.js');
      const context = await loadDecisionContext(workspaceId);
      const current = await RescuePlan.findOne({ _id: planId, workspaceId }).lean();
      const action = current?.actions.find(a => a.actionId === actionId);
      if (!action) return null;
      if (update.promiseId) {
        const item = await CashItem.findOne({ _id: action.cashItemId, workspaceId, category: 'receivable' }).lean();
        if (action.type !== 'accelerate_collection' || !item?.paymentPromises?.some(p => String(p._id) === update.promiseId))
          throw new DecisionValidationError('Promise must belong to this collection action’s invoice', 'promiseId');
      }
      const changes = Object.fromEntries(Object.entries(update).map(([field, value]) => [`actions.$.${field}`, value]));
      const updated = await RescuePlan.findOneAndUpdate({ _id: planId, workspaceId, __v: current.__v, 'actions.actionId': actionId }, {
        $set: changes, $inc: { __v: 1 }, $push: { 'actions.$.history': { at: new Date(), asOfDate: context.asOfDate,
          fromStatus: action.status, toStatus: update.status || action.status, ownerNotes: update.ownerNotes ?? action.ownerNotes,
          promiseId: update.promiseId === undefined ? action.promiseId : update.promiseId } },
      }, { new: true, runValidators: true }).lean();
      if (!updated) throw new DecisionValidationError('Plan changed. Refresh and retry the action update.', 'planId');
      return updated;
    });
    const plan = await updateAction({ ...req.params, update });
    if (!plan) return notFound(res, 'Plan or action not found');
    const context = await (dependencies.loadContext ?? loadDecisionContext)(req.params.workspaceId);
    res.json({ ...plan, live: evaluatePlan(context, plan) });
  }, dependencies);
}
