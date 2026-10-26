import { ZodError } from 'zod';
import mongoose from 'mongoose';
import Workspace from '../models/Workspace.js';

export const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

export function fail(status, code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status, code, details });
  throw error;
}

export function validate(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail(400, 'VALIDATION_ERROR', 'Invalid request data', parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })));
  return parsed.data;
}

export async function workspaceOr404(id) {
  if (!mongoose.isValidObjectId(id)) fail(404, 'NOT_FOUND', 'Workspace not found');
  const workspace = await Workspace.findById(id);
  if (!workspace) fail(404, 'NOT_FOUND', 'Workspace not found');
  return workspace;
}

export function errorResponse(err, _req, res, _next) {
  if (err instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' } });
  if (err.code === 11000) return res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'A record with this source ID already exists' } });
  if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
  if (err.status) return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) } });
  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
