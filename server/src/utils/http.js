import { ZodError } from 'zod';
import mongoose from 'mongoose';
import Workspace from '../models/Workspace.js';

export const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function fail(status, code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status, code, details, isOperational: true });
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

function logServerError(req, err) {
  console.error('[ErrorHandler]', {
    method: req?.method,
    path: req?.originalUrl,
    name: err?.name,
    code: err?.code,
    status: err?.status,
    message: err?.message,
    stack: err?.stack,
  });
}

export function errorResponse(err, req, res, _next) {
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
    logServerError(req, err);
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON request body' } });
  }
  if (err?.type === 'entity.too.large') {
    logServerError(req, err);
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large' } });
  }
  if (err?.name === 'VersionError') {
    logServerError(req, err);
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Record changed. Refresh before trying again.' } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' } });
  }
  if (err?.code === 11000) {
    logServerError(req, err);
    return res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'A record with this source ID already exists' } });
  }
  if (err?.name === 'ValidationError' || err?.name === 'CastError') {
    logServerError(req, err);
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' } });
  }
  if (err?.name?.startsWith('Mongo') || err?.name === 'MongooseError' || err?.name === 'BSONError') {
    logServerError(req, err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
  if (err?.isOperational || err?.name === 'RateLimitConfigError' || (err?.status && err?.code && err.status < 500)) {
    if (err.status >= 500) logServerError(req, err);
    return res.status(err.status).json({ error: { code: err.code || 'REQUEST_ERROR', message: err.message, ...(err.details && { details: err.details }) } });
  }
  logServerError(req, err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
