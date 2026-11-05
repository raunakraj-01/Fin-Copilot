import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, fail, validate } from '../utils/http.js';
import { loadDecisionContext } from '../services/rescue/decisionContext.js';
import { DecisionValidationError } from '../services/rescue/validation.js';
import { spendingCheck } from '../services/finance/spending.js';

const router = Router({ mergeParams: true });
const query = z.object({
  horizonDays: z.enum(['7', '30', '60', '90']).default('30').transform(Number),
  delayDays: z.enum(['7', '15', '30']).default('7').transform(Number),
  spendPaise: z.string().regex(/^\d+$/).default('0').transform(Number).refine(Number.isSafeInteger),
  commitmentsConfirmed: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
}).strict();
router.get('/', asyncRoute(async (req, res) => {
  const options = validate(query, req.query);
  if (!/^[a-f\d]{24}$/i.test(req.params.workspaceId)) fail(404, 'NOT_FOUND', 'Workspace not found');
  const context = await loadDecisionContext(req.params.workspaceId);
  if (!context) fail(404, 'NOT_FOUND', 'Workspace not found');
  try { res.json(spendingCheck({ ...context, horizonDays: options.horizonDays }, options)); }
  catch (error) {
    if (error instanceof DecisionValidationError) fail(400, 'VALIDATION_ERROR', error.message, error.details);
    throw error;
  }
}));
export default router;
