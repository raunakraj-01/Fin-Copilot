import { loadDecisionContext, loadSharedForecast } from '../services/rescue/decisionContext.js';
import { validateOrder } from '../services/orders/analyze.js';
import { prepareSavedScenario } from '../services/orders/saveScenario.js';
import { persistenceHandler, notFound, workspaceExists, validateId } from './rescuePersistenceHandler.js';
import { savedOrderTerms, scenarioFreshness, analysisFingerprint } from '../services/orders/freshness.js';
import { parseRequest } from '../services/rescue/validation.js';
import { fail } from '../utils/http.js';
import { z } from 'zod';

export function saveOrderScenarioHandler(dependencies = {}) {
  return persistenceHandler(async (req, res) => {
    validateOrder(req.body);
    const context = await (dependencies.loadContext ?? loadDecisionContext)(req.params.workspaceId);
    if (!context) return notFound(res, 'Workspace not found');
    const forecast = dependencies.buildForecast ?? await loadSharedForecast();
    const scenario = { workspaceId: req.params.workspaceId, ...prepareSavedScenario(context, req.body, forecast) };
    const createScenario = dependencies.createScenario ?? (async value => {
      const { default: OrderScenario } = await import('../models/OrderScenario.js');
      return OrderScenario.create(value);
    });
    res.status(201).json(await createScenario(scenario));
  }, dependencies);
}

export function listOrderScenariosHandler(dependencies = {}) {
  return persistenceHandler(async (req, res) => {
    if (!await (dependencies.workspaceExists ?? workspaceExists)(req.params.workspaceId)) return notFound(res, 'Workspace not found');
    const listScenarios = dependencies.listScenarios ?? (async workspaceId => {
      const { default: OrderScenario } = await import('../models/OrderScenario.js');
      return OrderScenario.find({ workspaceId }).sort({ createdAt: -1, _id: -1 }).limit(50).lean();
    });
    const scenarios = await listScenarios(req.params.workspaceId);
    const context = scenarios.length ? await (dependencies.loadContext ?? loadDecisionContext)(req.params.workspaceId) : null;
    res.json({ scenarios: scenarios.map(scenario => ({ ...scenario, freshness: scenarioFreshness(context, scenario) })), hypothetical: true, limit: 50 });
  }, dependencies);
}

export function recalculateOrderScenarioHandler(dependencies = {}) {
  return persistenceHandler(async (req, res) => {
    validateId(req.params.scenarioId, 'scenarioId');
    parseRequest(z.object({}).strict(), req.body ?? {});
    const loadContext = dependencies.loadContext ?? loadDecisionContext;
    const context = await loadContext(req.params.workspaceId);
    if (!context) return notFound(res, 'Workspace not found');
    const loadScenario = dependencies.loadScenario ?? (async (workspaceId, scenarioId) => {
      const { default: OrderScenario } = await import('../models/OrderScenario.js');
      return OrderScenario.findOne({ _id: scenarioId, workspaceId }).lean();
    });
    const scenario = await loadScenario(req.params.workspaceId, req.params.scenarioId);
    if (!scenario) return notFound(res, 'Scenario not found');
    const forecast = dependencies.buildForecast ?? await loadSharedForecast();
    const updated = prepareSavedScenario(context, savedOrderTerms(scenario), forecast);
    const latestContext = await loadContext(req.params.workspaceId);
    if (!latestContext || analysisFingerprint(latestContext, scenario) !== analysisFingerprint(context, scenario))
      fail(409, 'CONFLICT', 'Cash inputs changed during recalculation. Refresh and retry.');
    const persist = dependencies.recalculateScenario ?? (async (current, values) => {
      const { default: OrderScenario } = await import('../models/OrderScenario.js');
      return OrderScenario.findOneAndUpdate({ _id: current._id, workspaceId: req.params.workspaceId, __v: current.__v }, {
        $set: values, $inc: { __v: 1 }, $push: { analysisHistory: { $each: [{ analyzedAt: current.analyzedAt || current.createdAt,
          minimumAdvancePaise: current.simulatedMinimumAdvancePaise, analysisContext: current.analysisContext }], $slice: -50 } },
      }, { new: true, runValidators: true }).lean();
    });
    const result = await persist(scenario, updated);
    if (!result) fail(409, 'CONFLICT', 'This saved scenario changed. Refresh and retry.');
    const finalContext = await loadContext(req.params.workspaceId);
    res.json({ ...result, freshness: finalContext ? scenarioFreshness(finalContext, result)
      : { stale: true, reason: 'inputs_changed', message: 'Workspace changed after recalculation. Refresh before using this result.' } });
  }, dependencies);
}
