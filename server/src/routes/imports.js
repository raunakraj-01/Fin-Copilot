import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import ImportBatch from '../models/ImportBatch.js';
import CashItem from '../models/CashItem.js';
import { parseUpload, suggestMapping } from '../services/imports/parse.js';
import { normalizeRows } from '../services/imports/normalize.js';
import { invoiceIdentity, canonicalId, digest } from '../services/imports/identity.js';

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const keys = ['externalId', 'counterparty', 'amountInr', 'settledInr', 'dueDate', 'expectedDate', 'status',
  'mandatory', 'negotiable', 'discretionary', 'maxExtensionDays', 'earliestCollectionDate',
  'maxEarlyCollectionInr', 'estimatedActionCostInr', 'actionCostDate'];
const validateInput = z.object({ mapping: z.record(z.string(), z.string()).refine(value => Object.keys(value).every(key => keys.includes(key)), 'Unknown mapping field'),
  sourceSystem: z.enum(['csv', 'excel', 'tally_export']).optional() }).strict();
const correctionInput = z.object({ rowNumber: z.number().int().min(2), values: z.record(z.string(), z.string()) });
const commitInput = z.object({ corrections: z.array(correctionInput).default([]), excludedRowNumbers: z.array(z.number().int().min(2)).default([]) }).strict();

async function batchOr404(req) {
  if (!mongoose.isValidObjectId(req.params.batchId)) fail(404, 'NOT_FOUND', 'Import batch not found');
  const batch = await ImportBatch.findOne({ _id: req.params.batchId, workspaceId: req.params.workspaceId, kind: { $in: ['receivables', 'payables'] } });
  if (!batch) fail(404, 'NOT_FOUND', 'Import batch not found');
  return batch;
}

router.post('/inspect', upload.single('file'), asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const kind = validate(z.enum(['receivables', 'payables']), req.body.kind);
  if (!req.file) fail(400, 'VALIDATION_ERROR', 'File is required');
  const parsed = await parseUpload(req.file);
  const mapping = suggestMapping(parsed.headers);
  const batch = await ImportBatch.create({ workspaceId: req.params.workspaceId, fileName: req.file.originalname,
    fileType: parsed.type, kind, sourceSystem: parsed.type === 'xlsx' ? 'excel' : 'csv',
    headers: parsed.headers, rawRows: parsed.rawRows, mapping,
    counts: { accepted: 0, needsReview: 0, rejected: 0, committed: 0 } });
  res.status(201).json({ batchId: String(batch._id), headers: parsed.headers, sampleRows: parsed.rawRows.slice(0, 5), suggestedMapping: mapping });
}));

router.post('/:batchId/validate', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const batch = await batchOr404(req);
  if (['committed', 'committing'].includes(batch.status)) fail(409, 'DUPLICATE_RECORD', 'Batch is already committing or committed');
  const input = validate(validateInput, req.body);
  if (Object.values(input.mapping).some(header => !batch.headers.includes(header))) fail(400, 'VALIDATION_ERROR', 'Mapping refers to an unknown header');
  const rows = normalizeRows(batch.rawRows, input.mapping, batch.kind, input.sourceSystem || batch.sourceSystem);
  batch.mapping = input.mapping;
  batch.sourceSystem = input.sourceSystem || batch.sourceSystem;
  batch.previewRows = rows;
  batch.rowIssues = rows.flatMap(row => row.issues);
  batch.counts = { accepted: rows.filter(row => row.state === 'accepted').length,
    needsReview: rows.filter(row => row.state === 'needsReview').length,
    rejected: rows.filter(row => row.state === 'rejected').length, committed: 0 };
  batch.status = 'validated';
  await batch.save();
  res.json({ batchId: String(batch._id), rows, counts: batch.counts, warnings: batch.rowIssues.filter(issue => issue.severity === 'review'),
    errors: batch.rowIssues.filter(issue => issue.severity === 'error') });
}));

router.post('/:batchId/commit', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const batch = await batchOr404(req);
  if (batch.status === 'committed') return res.json({ ...(batch.commitSummary || { savedCount: batch.counts.committed, skippedCount: 0, duplicateConflicts: [] }), alreadyCommitted: true });
  if (!['validated', 'committing'].includes(batch.status)) fail(422, 'NEEDS_REVIEW', 'Validate the mapping before commit');
  const { corrections, excludedRowNumbers } = validate(commitInput, req.body);
  const rowNumbers = new Set(batch.rawRows.map(row => row.rowNumber));
  if ([...corrections.map(c => c.rowNumber), ...excludedRowNumbers].some(n => !rowNumbers.has(n)) || new Set(corrections.map(c => c.rowNumber)).size !== corrections.length || new Set(excludedRowNumbers).size !== excludedRowNumbers.length)
    fail(400, 'VALIDATION_ERROR', 'Corrections and exclusions must reference existing rows without duplicates');
  const excluded = new Set(excludedRowNumbers);
  const amended = batch.rawRows.map(row => {
    const correction = corrections.find(value => value.rowNumber === row.rowNumber);
    if (!correction) return row;
    const overrides = {};
    for (const [fieldOrHeader, value] of Object.entries(correction.values)) {
      const field = keys.includes(fieldOrHeader) ? fieldOrHeader
        : Object.keys(batch.mapping).find(key => batch.mapping[key] === fieldOrHeader);
      if (!field) fail(400, 'VALIDATION_ERROR', 'Correction refers to an unknown field');
      overrides[field] = value;
    }
    return { rowNumber: row.rowNumber, values: row.values, overrides };
  });
  const rows = normalizeRows(amended.filter(row => !excluded.has(row.rowNumber)), batch.mapping, batch.kind, batch.sourceSystem);
  if (rows.some(row => row.state !== 'accepted')) fail(422, 'NEEDS_REVIEW', 'Correct or exclude all review and rejected rows', rows.flatMap(row => row.issues));
  const fingerprint = digest(rows.map(row => row.item));
  if (batch.status === 'committing' && batch.commitFingerprint !== fingerprint) fail(409, 'CONFLICT', 'Retry with the same reviewed rows; this batch has already started committing');
  if (batch.status === 'validated') {
    const claimed = await ImportBatch.updateOne({ _id: batch._id, status: 'validated', __v: batch.__v }, { $set: { status: 'committing', commitFingerprint: fingerprint }, $inc: { __v: 1 } });
    if (!claimed.modifiedCount) fail(409, 'CONFLICT', 'Batch changed. Refresh or retry the same reviewed import.');
  }
  const duplicateConflicts = [];
  await CashItem.init();
  const existing = await CashItem.find({ workspaceId: batch.workspaceId, category: batch.kind === 'receivables' ? 'receivable' : 'payable' }).lean();
  const byId = new Map(existing.filter(item => item.externalId).map(item => [canonicalId(item.externalId), item]));
  for (const row of rows) {
    const item = row.item;
    const previous = byId.get(canonicalId(item.externalId));
    if (previous) {
      if (String(previous.importBatchId) !== String(batch._id)) duplicateConflicts.push({ rowNumber: row.rowNumber, externalId: item.externalId,
        changed: previous.amountPaise !== item.amountPaise || previous.settledPaise !== item.settledPaise || previous.expectedDate !== item.expectedDate || previous.counterparty !== item.counterparty });
      continue;
    }
    const key = { workspaceId: batch.workspaceId, importIdentity: invoiceIdentity(item) };
    try {
      await CashItem.updateOne(key, { $setOnInsert: { ...item, ...key, importBatchId: batch._id } }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
    const stored = await CashItem.findOne(key).lean();
    if (!stored || String(stored.importBatchId) !== String(batch._id)) duplicateConflicts.push({ rowNumber: row.rowNumber, externalId: item.externalId });
  }
  const savedCount = await CashItem.countDocuments({ workspaceId: batch.workspaceId, importBatchId: batch._id });
  const summary = { savedCount, skippedCount: excluded.size + duplicateConflicts.length, duplicateConflicts };
  await ImportBatch.updateOne({ _id: batch._id, status: 'committing', commitFingerprint: fingerprint }, { $set: { status: 'committed', 'counts.committed': savedCount, commitSummary: summary }, $inc: { __v: 1 } });
  res.json(summary);
}));

export default router;
