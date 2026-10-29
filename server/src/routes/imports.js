import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import ImportBatch from '../models/ImportBatch.js';
import CashItem from '../models/CashItem.js';
import { parseUpload, suggestMapping } from '../services/imports/parse.js';
import { normalizeRows } from '../services/imports/normalize.js';

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
  const batch = await ImportBatch.findOne({ _id: req.params.batchId, workspaceId: req.params.workspaceId });
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
    fileType: parsed.type, kind, sourceSystem: parsed.type === 'csv' ? 'csv' : 'excel',
    headers: parsed.headers, rawRows: parsed.rawRows, mapping,
    counts: { accepted: 0, needsReview: 0, rejected: 0, committed: 0 } });
  res.status(201).json({ batchId: String(batch._id), headers: parsed.headers, sampleRows: parsed.rawRows.slice(0, 5), suggestedMapping: mapping });
}));

router.post('/:batchId/validate', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const batch = await batchOr404(req);
  if (batch.status === 'committed') fail(409, 'DUPLICATE_RECORD', 'Batch already committed');
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
  if (batch.status === 'committed') return res.json({ savedCount: batch.counts.committed, skippedCount: 0,
    duplicateConflicts: [], alreadyCommitted: true });
  if (batch.status !== 'validated') fail(422, 'NEEDS_REVIEW', 'Validate the mapping before commit');
  const { corrections, excludedRowNumbers } = validate(commitInput, req.body);
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
  const duplicateConflicts = [];
  let savedCount = 0;
  for (const row of rows) {
    const item = row.item;
    const key = { workspaceId: batch.workspaceId, category: item.category, sourceSystem: item.sourceSystem, externalId: item.externalId };
    const result = await CashItem.updateOne(key, { $setOnInsert: { ...item, workspaceId: batch.workspaceId, importBatchId: batch._id } }, { upsert: true });
    if (result.upsertedCount) savedCount++;
    else duplicateConflicts.push({ rowNumber: row.rowNumber, externalId: item.externalId });
  }
  batch.status = 'committed';
  batch.counts.committed = savedCount;
  await batch.save();
  res.json({ savedCount, skippedCount: excluded.size + duplicateConflicts.length, duplicateConflicts });
}));

export default router;
