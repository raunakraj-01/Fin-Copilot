import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import MessageCapture from '../models/MessageCapture.js';
import { requireAutomation } from '../middleware/auth.js';
import { requireOwner } from './offers.js';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { isDateOnly } from '../utils/dates.js';

const captureRouter = Router({ mergeParams: true });
const automationRouter = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const moneyTextPattern = /^(?:\d+|\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;

function parsePaise(value) {
  if (!moneyTextPattern.test(value)) return null;
  const numeric = Number(value.replaceAll(',', ''));
  const paise = Math.round(numeric * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

function parseDate(value) {
  return isDateOnly(value) ? value : null;
}

function parseStructuredMessage(rawText) {
  const [command = '', ...rawFields] = rawText.split('|');
  const kind = command.trim().toUpperCase();
  const fields = rawFields.map(field => field.trim());
  if (kind === 'PROMISE') {
    const [invoiceId = '', amountText = '', promisedDateText = ''] = fields;
    const amountPaise = parsePaise(amountText);
    const promisedDate = parseDate(promisedDateText);
    const issues = [];
    if (fields.length !== 3) issues.push('Use exactly three fields after PROMISE: invoice ID, amount, and promised date.');
    if (!invoiceId || invoiceId.length > 120) issues.push('Add the invoice number or ID after PROMISE.');
    if (!amountPaise || amountPaise < 1) issues.push('Enter a positive INR amount with up to two decimal places.');
    if (!promisedDate) issues.push('Enter the promised date as YYYY-MM-DD.');
    return {
      captureType: 'promise', parseStatus: issues.length ? 'needs_fields' : 'ready', parseIssues: issues,
      proposal: { kind: 'promise', invoiceId, amountPaise, promisedDate },
    };
  }
  if (kind === 'ORDER') {
    const [customerName = '', itemName = '', quantityText = '', deliveryDateText = '', valueText = '', advanceText = '', advanceDateText = '', finalCollectionDateText = ''] = fields;
    const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : null;
    const deliveryDate = parseDate(deliveryDateText);
    const orderValuePaise = parsePaise(valueText);
    const advancePaise = parsePaise(advanceText);
    const advanceDate = advanceDateText ? parseDate(advanceDateText) : null;
    const finalCollectionDate = finalCollectionDateText ? parseDate(finalCollectionDateText) : null;
    const issues = [];
    if (!customerName || customerName.length > 160) issues.push('Add the customer name.');
    if (!itemName || itemName.length > 200) issues.push('Add a short item or job description.');
    if (!Number.isSafeInteger(quantity) || quantity < 1) issues.push('Enter a positive whole-number quantity.');
    if (!deliveryDate) issues.push('Enter the delivery date as YYYY-MM-DD.');
    if (!orderValuePaise || orderValuePaise < 1) issues.push('Enter a positive order value in INR.');
    if (advancePaise == null || advancePaise < 0) issues.push('Enter the advance in INR (use 0 if there is no advance).');
    if (advancePaise != null && orderValuePaise != null && advancePaise > orderValuePaise) issues.push('Advance cannot exceed the order value.');
    if (!advanceDate && advancePaise > 0) issues.push('Add the expected advance date as YYYY-MM-DD.');
    if (!finalCollectionDate) issues.push('Add the final collection date as YYYY-MM-DD.');
    if (finalCollectionDate && advanceDate && finalCollectionDate < advanceDate) issues.push('Final collection cannot precede the advance date.');
    if (advanceDate && deliveryDate && advanceDate > deliveryDate) issues.push('Advance date cannot follow the delivery date.');
    if (finalCollectionDate && deliveryDate && finalCollectionDate < deliveryDate) issues.push('Final collection date cannot precede delivery.');
    if (fields.length !== 8) issues.push('Use exactly eight fields after ORDER, including both payment dates.');
    return {
      captureType: 'order', parseStatus: issues.length ? 'needs_fields' : 'ready', parseIssues: issues,
      proposal: { kind: 'order', customerName, itemName, quantity, deliveryDate, orderValuePaise, advancePaise, advanceDate, finalCollectionDate },
    };
  }
  return { captureType: 'unknown', parseStatus: 'unrecognized', parseIssues: ['Use ORDER|… or PROMISE|… to create a structured draft.'], proposal: null };
}

const captureShape = capture => ({ ...capture, id: String(capture._id) });

captureRouter.get('/', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  const status = req.query.status ? validate(z.enum(['pending', 'approved', 'rejected']), req.query.status) : undefined;
  const query = { workspaceId: req.params.workspaceId, ...(status ? { status } : {}) };
  const captures = await MessageCapture.find(query).sort({ receivedAt: -1, _id: -1 }).limit(200).lean();
  res.json({ captures: captures.map(captureShape), limit: 200 });
}));

captureRouter.post('/:captureId/review', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  if (!mongoose.isValidObjectId(req.params.captureId)) fail(404, 'NOT_FOUND', 'Capture not found');
  const decision = validate(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).default('') }).strict(), req.body);
  const capture = await MessageCapture.findOne({ _id: req.params.captureId, workspaceId: req.params.workspaceId });
  if (!capture) fail(404, 'NOT_FOUND', 'Capture not found');
  const nextStatus = decision.decision === 'approve' ? 'approved' : 'rejected';
  if (capture.status !== 'pending') {
    if (capture.status === nextStatus) return res.json({ capture: captureShape(capture.toObject()), actionable: capture.actionResult, duplicate: true });
    fail(409, 'CONFLICT', 'This capture has already been reviewed. Refresh before changing its decision.');
  }
  if (decision.decision === 'approve' && capture.parseStatus !== 'ready')
    fail(422, 'NEEDS_REVIEW', 'This message is missing or has invalid fields. Review it manually before approving.');

  const actionable = decision.decision === 'approve'
    ? capture.captureType === 'order'
      ? { type: 'order_analysis_draft', sourceCaptureId: String(capture._id), label: `${capture.proposal.customerName} · ${capture.proposal.itemName}`,
        customerName: capture.proposal.customerName, itemName: capture.proposal.itemName, quantity: capture.proposal.quantity,
        orderValuePaise: capture.proposal.orderValuePaise, advancePaise: capture.proposal.advancePaise,
        advanceDate: capture.proposal.advanceDate, deliveryDate: capture.proposal.deliveryDate,
        finalCollectionDate: capture.proposal.finalCollectionDate,
        instruction: 'Review this order in New Order Analyzer before sending a quote or committing production.' }
      : { type: 'payment_promise_draft', sourceCaptureId: String(capture._id), invoiceId: capture.proposal.invoiceId,
        amountPaise: capture.proposal.amountPaise, promisedDate: capture.proposal.promisedDate,
        senderPhone: capture.senderPhone, instruction: 'Find the matching receivable and confirm these terms in Payment Promises.' }
    : null;

  const now = new Date();
  const updated = await MessageCapture.findOneAndUpdate({ _id: capture._id, workspaceId: req.params.workspaceId, status: 'pending', __v: capture.__v }, {
    $set: { status: nextStatus, reviewedAt: now, reviewedBy: req.user._id, reviewNote: decision.note, actionResult: actionable }, $inc: { __v: 1 },
  }, { new: true, runValidators: true }).lean();
  if (!updated) fail(409, 'CONFLICT', 'Capture changed while it was being reviewed. Refresh and retry.');
  res.json({ capture: captureShape(updated), actionable });
}));

automationRouter.use(requireAutomation);
automationRouter.post('/messages', asyncRoute(async (req, res) => {
  const data = validate(z.object({
    messageId: z.string().trim().min(1).max(256),
    from: z.string().trim().max(32).default(''),
    profileName: z.string().trim().max(160).default(''),
    text: z.string().min(1).max(4000).refine(value => value.trim().length > 0, 'Message text cannot be blank.'),
    sourceSystem: z.enum(['whatsapp_cloud', 'n8n']).default('whatsapp_cloud'),
    receivedAt: z.union([z.string().datetime({ offset: true }), z.number().int().positive()]).optional(),
  }).strict(), req.body);
  const receivedAt = data.receivedAt === undefined ? new Date()
    : typeof data.receivedAt === 'number' ? new Date(data.receivedAt < 10_000_000_000 ? data.receivedAt * 1000 : data.receivedAt)
      : new Date(data.receivedAt);
  if (!Number.isFinite(receivedAt.valueOf())) fail(400, 'VALIDATION_ERROR', 'receivedAt must be a valid timestamp');
  const parsed = parseStructuredMessage(data.text);
  const fields = { workspaceId: req.service.workspaceId, sourceSystem: data.sourceSystem, sourceMessageId: data.messageId,
    senderPhone: data.from, senderName: data.profileName, rawText: data.text, receivedAt, ...parsed };
  try {
    const capture = await MessageCapture.create(fields);
    res.status(201).json({ capture: captureShape(capture.toObject()), duplicate: false });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const capture = await MessageCapture.findOne({ workspaceId: req.service.workspaceId, sourceSystem: data.sourceSystem,
      sourceMessageId: data.messageId }).lean();
    if (!capture) throw error;
    res.json({ capture: captureShape(capture), duplicate: true });
  }
}));

export { automationRouter, parseStructuredMessage };
export default captureRouter;
