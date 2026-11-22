import AuditEvent from '../models/AuditEvent.js';

const safeFields = new Set(['name', 'asOfDate', 'openingCashPaise', 'minimumReservePaise', 'category', 'externalId', 'counterparty',
  'amountPaise', 'settledPaise', 'status', 'dueDate', 'expectedDate', 'confidenceState', 'state', 'decision', 'share', 'mode',
  'recipientOptIn', 'cadenceDays', 'maxAttempts', 'note', 'mapping', 'excludedRowNumbers', 'corrections']);

export function appendAudit({ workspaceId, userId, serviceId, action, entityType, entityId = '', changedFields = [] }) {
  return AuditEvent.create({ workspaceId, actorType: userId ? 'user' : serviceId ? serviceId.kind === 'automation' ? 'automation' : 'sync_device' : 'system',
    actorId: userId || serviceId?._id || null, action, entityType, entityId: String(entityId || ''),
    changedFields: [...new Set(changedFields.filter(field => safeFields.has(field)))].slice(0, 30) });
}

export function auditBusinessRequest(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.params.workspaceId) return next();
  const route = (req.originalUrl.split('?')[0].match(/^\/api\/workspaces\/[^/]+\/(.*)$/)?.[1] || 'workspace').replace(/[a-f\d]{24}/gi, ':id');
  const parts = route.split('/').filter(Boolean);
  const id = req.originalUrl.match(/(?:^|\/)([a-f\d]{24})(?:\/|$|\?)/i)?.[1] || '';
  const changedFields = Object.keys(req.body || {});
  let recorded = false;
  const save = () => appendAudit({ workspaceId: req.params.workspaceId, userId: req.user?._id, serviceId: req.service,
    action: `${req.method} ${route}`.slice(0, 160), entityType: parts[0] || 'workspace', entityId: id, changedFields });
  const originalJson = res.json.bind(res);
  const originalEnd = res.end.bind(res);
  res.json = function (body) {
    if (recorded || res.statusCode < 200 || res.statusCode >= 300) return originalJson(body);
    recorded = true;
    save().then(() => originalJson(body)).catch(next);
    return res;
  };
  res.end = function (...args) {
    if (recorded || res.statusCode < 200 || res.statusCode >= 300) return originalEnd(...args);
    recorded = true;
    save().then(() => originalEnd(...args)).catch(next);
    return res;
  };
  next();
}
