import { Router } from 'express';
import { analyzeNewOrder, validateOrder } from '../services/orders/analyze.js';
import { decisionHandler } from '../controllers/rescueDecisionHandler.js';

export function createOrdersRouter(dependencies) {
  const router = Router({ mergeParams: true });
  router.post('/analyze', decisionHandler(analyzeNewOrder, validateOrder, dependencies));
  return router;
}
export default createOrdersRouter();
