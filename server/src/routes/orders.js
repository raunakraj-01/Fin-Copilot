import { Router } from 'express';
import { analyzeNewOrder, validateOrder } from '../services/orders/analyze.js';
import { decisionHandler } from '../controllers/rescueDecisionHandler.js';
import { saveOrderScenarioHandler, listOrderScenariosHandler, recalculateOrderScenarioHandler } from '../controllers/ordersScenarioHandler.js';
import { asyncRoute, fail, validate } from '../utils/http.js';
import { z } from 'zod';
import mongoose from 'mongoose';
import OrderScenario from '../models/OrderScenario.js';
import { requireOwner } from './offers.js';

export function createOrdersRouter(dependencies) {
  const router = Router({ mergeParams: true });
  router.post('/analyze', decisionHandler(analyzeNewOrder, validateOrder, dependencies));
  router.post('/scenarios', saveOrderScenarioHandler(dependencies));
  router.get('/scenarios', listOrderScenariosHandler(dependencies));
  router.post('/scenarios/:scenarioId/recalculate', recalculateOrderScenarioHandler(dependencies));
  router.patch('/scenarios/:scenarioId/tracking', asyncRoute(async (req, res) => {
    requireOwner(req);
    if (!mongoose.isValidObjectId(req.params.scenarioId)) fail(404, 'NOT_FOUND', 'Saved order not found');
    const data = validate(z.object({
      status: z.enum(['prospective', 'terms_requested', 'accepted', 'in_production', 'delivered', 'awaiting_collection', 'completed', 'cancelled']),
      note: z.string().trim().max(500).default(''),
    }).strict(), req.body);
    const current = await OrderScenario.findOne({ _id: req.params.scenarioId, workspaceId: req.params.workspaceId });
    if (!current) fail(404, 'NOT_FOUND', 'Saved order not found');
    const now = new Date();
    const updated = await OrderScenario.findOneAndUpdate({ _id: current._id, workspaceId: req.params.workspaceId, __v: current.__v }, {
      $set: { trackingStatus: data.status, trackingNote: data.note, trackingUpdatedAt: now },
      $push: { trackingHistory: { $each: [{ status: data.status, note: data.note, at: now, actorUserId: req.user._id }], $slice: -100 } },
      $inc: { __v: 1 },
    }, { new: true, runValidators: true }).lean();
    if (!updated) fail(409, 'CONFLICT', 'Saved order changed. Refresh and try again.');
    res.json({ scenario: updated });
  }));
  return router;
}
export default createOrdersRouter();
