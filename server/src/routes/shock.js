import { Router } from 'express';
import { decisionHandler } from '../controllers/rescueDecisionHandler.js';
import { analyzeShock, validateShock } from '../services/finance/shock.js';
import { createExplanationAnalyzer, validateExplanation } from '../services/finance/explain.js';

export function createShockRouter(dependencies = {}) {
  const router = Router({ mergeParams: true });
  router.post('/analyze', decisionHandler(analyzeShock, validateShock, dependencies));
  router.post('/explain', decisionHandler(createExplanationAnalyzer(dependencies.ai), validateExplanation, dependencies));
  return router;
}
export default createShockRouter();
