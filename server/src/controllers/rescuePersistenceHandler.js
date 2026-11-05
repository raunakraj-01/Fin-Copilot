import { DecisionValidationError } from '../services/rescue/validation.js';

export function validateId(value, field) {
  if (!/^[a-fA-F0-9]{24}$/.test(value ?? '')) throw new DecisionValidationError(`${field} must be a valid MongoDB object ID`, field);
}

export function persistenceHandler(operation, dependencies = {}) {
  return async (req, res) => {
    try {
      validateId(req.params.workspaceId, 'workspaceId');
      await operation(req, res);
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: { code: error.code || 'CONFLICT', message: error.message } });
      if (error instanceof DecisionValidationError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: error.message, details: error.details } });
      (dependencies.logError ?? console.error)(error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Could not complete this request', details: [] } });
    }
  };
}

export const notFound = (res, message) => res.status(404).json({ error: { code: 'NOT_FOUND', message, details: [] } });
export async function workspaceExists(workspaceId) {
  const { default: Workspace } = await import('../models/Workspace.js');
  return !!await Workspace.exists({ _id: workspaceId });
}
