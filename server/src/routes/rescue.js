import { Router } from 'express';
import { analyzeRescue } from '../services/rescue/analyze.js';
import { validateRescueOptions } from '../services/rescue/validation.js';
import { decisionHandler, saveRescuePlanHandler } from '../controllers/rescueDecisionHandler.js';

export function createRescueRouter(dependencies) {
  const router = Router({ mergeParams: true });
  router.post('/analyze', decisionHandler(analyzeRescue, validateRescueOptions, dependencies));
  router.post('/plans', saveRescuePlanHandler(dependencies));
  return router;
}
export default createRescueRouter();
