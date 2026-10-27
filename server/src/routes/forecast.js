import { Router } from 'express';
import { asyncRoute, fail, workspaceOr404 } from '../utils/http.js';
import CashItem from '../models/CashItem.js';
import RecurringRule from '../models/RecurringRule.js';
import { buildForecast } from '../services/finance/forecast.js';

const router = Router({ mergeParams: true });
router.get('/', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  const horizonDays = req.query.horizonDays === undefined ? 90 : Number(req.query.horizonDays);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366) fail(400, 'VALIDATION_ERROR', 'horizonDays must be 1–366');
  const [items, rules] = await Promise.all([
    CashItem.find({ workspaceId: workspace._id }).lean(), RecurringRule.find({ workspaceId: workspace._id }).lean(),
  ]);
  const cashItems = items.map(item => ({ ...item, id: String(item._id), ...item.constraints }));
  res.json(buildForecast({ asOfDate: workspace.asOfDate, openingCashPaise: workspace.openingCashPaise,
    minimumReservePaise: workspace.minimumReservePaise, horizonDays, cashItems, recurringRules: rules }));
}));
export default router;
