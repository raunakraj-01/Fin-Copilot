import { loadDecisionContext, loadSharedForecast } from '../services/rescue/decisionContext.js';
import { validateOrder } from '../services/orders/analyze.js';
import { prepareSavedScenario } from '../services/orders/saveScenario.js';
import { persistenceHandler, notFound, workspaceExists } from './rescuePersistenceHandler.js';

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
    res.json({ scenarios: await listScenarios(req.params.workspaceId), hypothetical: true, limit: 50 });
  }, dependencies);
}
