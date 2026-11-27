import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import BankTransaction from '../models/BankTransaction.js';
import ImportBatch from '../models/ImportBatch.js';
import CashItem from '../models/CashItem.js';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { createSpreadsheetUpload, safeUploadFilename } from '../middleware/upload.js';
import { parseUpload } from '../services/imports/parse.js';
import { canonicalId, digest } from '../services/imports/identity.js';
import { bankFields, bankMapping, normalizeBankRows, availablePaise, availableDebitPaise, matchingSuggestions } from '../services/imports/bank.js';
import { matchBankCredit, matchBankDebit } from '../services/finance/bankMatching.js';
import { itemPromiseStates } from '../services/finance/promises.js';

const router = Router({ mergeParams: true });
const upload = createSpreadsheetUpload(2 * 1024 * 1024);
const mappingInput = z.object({ mapping: z.record(z.string(), z.string()).refine(m => Object.keys(m).every(k => bankFields.includes(k))) }).strict();
const commitInput = z.object({ corrections: z.array(z.object({ rowNumber: z.number().int().min(2), values: z.record(z.string(), z.string()).refine(v => Object.keys(v).every(k => bankFields.includes(k))) }).strict()).default([]),
  excludedRowNumbers: z.array(z.number().int().min(2)).default([]) }).strict();
const matchInput = z.object({ requestId: z.string().uuid(), cashItemId: z.string().regex(/^[a-f\d]{24}$/i),
  amountPaise: z.number().int().safe().positive(), promiseId: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional() }).strict();
const validId = value => { if (!mongoose.isValidObjectId(value)) fail(404, 'NOT_FOUND', 'Bank record not found'); };
async function batchFor(req) {
  validId(req.params.batchId);
  const batch = await ImportBatch.findOne({ _id: req.params.batchId, workspaceId: req.params.workspaceId, kind: 'bank' });
  if (!batch) fail(404, 'NOT_FOUND', 'Bank import not found'); return batch;
}
router.post('/imports/inspect', upload.single('file'), asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const accountKey = canonicalId(validate(z.string().trim().min(1).max(100), req.body.accountKey));
  if (!req.file) fail(400, 'VALIDATION_ERROR', 'File is required');
  const parsed = await parseUpload(req.file); const mapping = bankMapping(parsed.headers);
  const batch = await ImportBatch.create({ workspaceId: req.params.workspaceId, kind: 'bank', accountKey,
    fileName: safeUploadFilename(req.file.originalname), fileType: parsed.type, sourceSystem: parsed.type === 'csv' ? 'csv' : 'excel',
    headers: parsed.headers, rawRows: parsed.rawRows, mapping });
  res.status(201).json({ batchId: String(batch._id), headers: parsed.headers, suggestedMapping: mapping });
}));
router.post('/imports/:batchId/validate', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId); const batch = await batchFor(req);
  if (['committing', 'committed'].includes(batch.status)) fail(409, 'CONFLICT', 'Bank import already started committing');
  const { mapping } = validate(mappingInput, req.body);
  if (Object.values(mapping).some(h => !batch.headers.includes(h))) fail(400, 'VALIDATION_ERROR', 'Unknown mapping header');
  const rows = normalizeBankRows(batch.rawRows, mapping, batch.accountKey);
  batch.mapping = mapping; batch.status = 'validated'; batch.previewRows = rows; await batch.save();
  res.json({ rows });
}));
router.post('/imports/:batchId/commit', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId); const batch = await batchFor(req);
  if (batch.status === 'committed') return res.json({ ...batch.commitSummary, alreadyCommitted: true });
  if (!['validated', 'committing'].includes(batch.status)) fail(422, 'NEEDS_REVIEW', 'Validate bank rows before importing');
  const input = validate(commitInput, req.body);
  const ids = new Set(batch.rawRows.map(r => r.rowNumber));
  if ([...input.corrections.map(c => c.rowNumber), ...input.excludedRowNumbers].some(n => !ids.has(n))
    || new Set(input.corrections.map(c => c.rowNumber)).size !== input.corrections.length || new Set(input.excludedRowNumbers).size !== input.excludedRowNumbers.length)
    fail(400, 'VALIDATION_ERROR', 'Corrections and exclusions must reference existing rows without duplicates');
  const rows = normalizeBankRows(batch.rawRows, batch.mapping, batch.accountKey, input.corrections, input.excludedRowNumbers);
  if (rows.some(r => r.state !== 'accepted')) fail(422, 'NEEDS_REVIEW', 'Correct or exclude invalid bank rows');
  const fingerprint = digest(rows.map(r => r.item));
  if (batch.status === 'committing' && batch.commitFingerprint !== fingerprint) fail(409, 'CONFLICT', 'Retry the same reviewed bank rows');
  if (batch.status === 'validated') {
    const claim = await ImportBatch.updateOne({ _id: batch._id, status: 'validated', __v: batch.__v }, { $set: { status: 'committing', commitFingerprint: fingerprint }, $inc: { __v: 1 } });
    if (!claim.modifiedCount) fail(409, 'CONFLICT', 'Import changed. Refresh and retry the same rows.');
  }
  const duplicateConflicts = [];
  await BankTransaction.init();
  for (const row of rows) {
    const key = { workspaceId: batch.workspaceId, identity: row.item.identity };
    try { await BankTransaction.updateOne(key, { $setOnInsert: { ...row.item, workspaceId: batch.workspaceId, importBatchId: batch._id } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    const stored = await BankTransaction.findOne(key).lean();
    if (String(stored.importBatchId) !== String(batch._id)) duplicateConflicts.push({ rowNumber: row.rowNumber, transactionId: row.item.transactionId,
      changed: stored.date !== row.item.date || stored.creditPaise !== row.item.creditPaise || stored.debitPaise !== row.item.debitPaise || stored.description !== row.item.description });
  }
  const savedCount = await BankTransaction.countDocuments({ workspaceId: batch.workspaceId, importBatchId: batch._id });
  const summary = { savedCount, duplicateConflicts, skippedCount: input.excludedRowNumbers.length + duplicateConflicts.length };
  await ImportBatch.updateOne({ _id: batch._id, status: 'committing', commitFingerprint: fingerprint }, { $set: { status: 'committed', commitSummary: summary }, $inc: { __v: 1 } });
  res.json(summary);
}));
router.get('/', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  const offset = validate(z.coerce.number().int().min(0).max(1000000), req.query.offset ?? 0);
  const [transactions, invoices, ledgerRecords, total] = await Promise.all([
    BankTransaction.find({ workspaceId: workspace._id }).sort({ date: -1, _id: -1 }).skip(offset).limit(500).lean(),
    CashItem.find({ workspaceId: workspace._id, category: 'receivable', status: { $in: ['open', 'partial'] } }).lean(),
    CashItem.find({ workspaceId: workspace._id, category: { $in: ['payable', 'expense'] }, status: { $in: ['open', 'partial'] } }).lean(),
    BankTransaction.countDocuments({ workspaceId: workspace._id }),
  ]);
  res.json({ asOfDate: workspace.asOfDate, limit: 500, offset, total, transactions: transactions.map(t => ({ ...t, id: String(t._id), availablePaise: availablePaise(t),
    availableDebitPaise: availableDebitPaise(t),
    suggestions: t.reviewState === 'open' && availablePaise(t) > 0 ? matchingSuggestions(t, invoices.filter(i => i.confidenceState !== 'needs_review')) : [],
    debitSuggestions: t.reviewState === 'open' && availableDebitPaise(t) > 0 ? matchingSuggestions({ ...t, creditPaise: t.debitPaise,
      allocations: t.allocations.filter(a => a.direction === 'debit').map(a => ({ ...a, direction: 'credit' })) }, ledgerRecords.filter(i => i.confidenceState !== 'needs_review')) : [] })),
    invoices: invoices.map(i => ({ id: String(i._id), externalId: i.externalId, counterparty: i.counterparty,
      outstandingPaise: i.amountPaise - i.settledPaise, confidenceState: i.confidenceState, promises: itemPromiseStates(i, workspace.asOfDate) })),
    ledgerRecords: ledgerRecords.map(i => ({ id: String(i._id), externalId: i.externalId, category: i.category, counterparty: i.counterparty,
      outstandingPaise: i.amountPaise - i.settledPaise, confidenceState: i.confidenceState })) });
}));
router.post('/:transactionId/match', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId); validId(req.params.transactionId);
  res.json(await matchBankCredit(workspace, req.params.transactionId, validate(matchInput, req.body)));
}));
router.post('/:transactionId/match-debit', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId); validId(req.params.transactionId);
  const input = validate(matchInput.omit({ promiseId: true }), req.body);
  res.json(await matchBankDebit(workspace, req.params.transactionId, input));
}));
router.patch('/:transactionId/review', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId); validId(req.params.transactionId);
  const { state, note } = validate(z.object({ state: z.enum(['open', 'excluded']), note: z.string().trim().min(1).max(1000) }).strict(), req.body);
  const item = await BankTransaction.findOne({ _id: req.params.transactionId, workspaceId: req.params.workspaceId }).lean();
  if (!item) fail(404, 'NOT_FOUND', 'Bank transaction not found');
  if (item.allocations.some(a => a.status === 'pending')) fail(409, 'CONFLICT', 'Finish pending matches before reviewing the unmatched remainder');
  const updated = await BankTransaction.findOneAndUpdate({ _id: item._id, workspaceId: item.workspaceId, version: item.version },
    { $set: { reviewState: state, reviewNote: note }, $push: { reviewHistory: { at: new Date(), state, note } }, $inc: { version: 1 } }, { new: true }).lean();
  if (!updated) fail(409, 'CONFLICT', 'Bank transaction changed. Refresh before reviewing.');
  res.json({ transaction: updated });
}));
export default router;
