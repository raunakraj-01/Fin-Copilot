import { DecisionValidationError } from '../services/rescue/validation.js';
import { loadDecisionContext, loadSharedForecast } from '../services/rescue/decisionContext.js';

export function decisionHandler(analyze, validate, dependencies = {}) {
  const loadContext = dependencies.loadContext ?? loadDecisionContext;
  return async (req, res) => {
    try {
      if (!/^[a-fA-F0-9]{24}$/.test(req.params.workspaceId ?? '')) throw new DecisionValidationError('workspaceId must be a valid MongoDB object ID', 'workspaceId');
      validate(req.body);
      const context = await loadContext(req.params.workspaceId);
      if (!context) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found', details: [] } });
      const buildForecast = dependencies.buildForecast ?? await loadSharedForecast();
      return res.json(analyze(context, req.body, buildForecast));
    } catch (error) {
      if (error instanceof DecisionValidationError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: error.message, details: error.details } });
      (dependencies.logError ?? console.error)(error);
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Could not analyze this scenario', details: [] } });
    }
  };
}
