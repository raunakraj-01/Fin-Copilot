import { Router } from 'express';
import { asyncRoute, fail, workspaceOr404 } from '../utils/http.js';
import { loadDecisionContext } from '../services/rescue/decisionContext.js';
import { buildForecast } from '../services/finance/forecast.js';

const router = Router({ mergeParams: true });
router.get('/', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const horizonDays = req.query.horizonDays === undefined ? 90 : Number(req.query.horizonDays);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366) fail(400, 'VALIDATION_ERROR', 'horizonDays must be 1–366');
  const context = await loadDecisionContext(req.params.workspaceId);
  if (!context) fail(404, 'NOT_FOUND', 'Workspace not found');
  res.json(buildForecast({ ...context, horizonDays }));
}));
export default router;
