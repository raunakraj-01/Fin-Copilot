import { Router } from 'express';
import { analyzeNewOrder, validateOrder } from '../services/orders/analyze.js';
import { decisionHandler } from '../controllers/rescueDecisionHandler.js';
import { saveOrderScenarioHandler, listOrderScenariosHandler, recalculateOrderScenarioHandler } from '../controllers/ordersScenarioHandler.js';

export function createOrdersRouter(dependencies) {
  const router = Router({ mergeParams: true });
  router.post('/analyze', decisionHandler(analyzeNewOrder, validateOrder, dependencies));
  router.post('/scenarios', saveOrderScenarioHandler(dependencies));
  router.get('/scenarios', listOrderScenariosHandler(dependencies));
  router.post('/scenarios/:scenarioId/recalculate', recalculateOrderScenarioHandler(dependencies));
  return router;
}
export default createOrdersRouter();
