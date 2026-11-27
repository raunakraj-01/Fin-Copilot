import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { createXmlUpload, validateXmlMeta } from '../middleware/upload.js';
import { generateMorningBrief } from '../services/automation/morningBrief.js';
import { morningBriefEnabled } from '../services/automation/morningBriefScheduler.js';
import { parseTallyXml } from '../services/imports/tallyXml.js';
import { runFollowups } from '../services/finance/followups.js';
import CashItem from '../models/CashItem.js';
import SyncBatch from '../models/SyncBatch.js';

const router = Router({ mergeParams: true });
const XML_MAX_BYTES = 5 * 1024 * 1024;
const upload = createXmlUpload(XML_MAX_BYTES);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

// GET Morning Cash Brief preview
router.get('/morning-brief', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const asOfDate = req.query.asOfDate ? String(req.query.asOfDate) : undefined;
  const brief = await generateMorningBrief(req.params.workspaceId, asOfDate);
  res.json({ ...brief, schedulerEnabled: morningBriefEnabled(), scheduleIST: process.env.MORNING_BRIEF_SCHEDULE || '07:00' });
}));

// POST Morning Cash Brief dispatch
router.post('/morning-brief/dispatch', asyncRoute(async (req, res) => {
  const workspace = await workspaceOr404(req.params.workspaceId);
  const brief = await generateMorningBrief(req.params.workspaceId);
  res.json({
    success: true,
    dispatchedAt: new Date().toISOString(),
    recipient: workspace.name,
    message: brief.whatsappText,
    whatsappUrl: brief.whatsappUrl,
  });
}));

// POST Ingest TallyPrime XML directly
router.post('/tally-xml', upload.single('file'), asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);

  let xmlString = '';
  if (req.file) {
    validateXmlMeta(req.file);
    if (!Buffer.isBuffer(req.file.buffer) || req.file.buffer.length === 0) {
      fail(400, 'VALIDATION_ERROR', 'Uploaded XML file is empty');
    }
    if (req.file.buffer.includes(0x00)) {
      fail(400, 'VALIDATION_ERROR', 'Uploaded XML file contains binary null bytes');
    }
    try {
      xmlString = utf8Decoder.decode(req.file.buffer);
    } catch {
      fail(400, 'VALIDATION_ERROR', 'Uploaded XML file must contain valid UTF-8 text');
    }
  } else if (req.body && typeof req.body.xml === 'string') {
    xmlString = req.body.xml;
  } else if (typeof req.body === 'string') {
    xmlString = req.body;
  }

  if (Buffer.byteLength(xmlString, 'utf8') > XML_MAX_BYTES) {
    fail(413, 'UPLOAD_TOO_LARGE', 'XML payload exceeds the 5 MB limit');
  }
  if (/<!(?:doctype|entity)\b|<script\b/i.test(xmlString)) {
    fail(400, 'VALIDATION_ERROR', 'Disallowed DTD or script content in XML');
  }
  if (!xmlString || !xmlString.includes('<ENVELOPE>') || !xmlString.includes('</ENVELOPE>')) {
    fail(400, 'VALIDATION_ERROR', 'Valid Tally XML with <ENVELOPE>...</ENVELOPE> is required');
  }

  const parsed = parseTallyXml(xmlString);
  if (!parsed.vouchers || parsed.vouchers.length === 0) {
    fail(400, 'VALIDATION_ERROR', 'No valid financial vouchers found in Tally XML');
  }

  const batchId = randomUUID();
  const createdItems = [];

  for (const v of parsed.vouchers) {
    const key = {
      workspaceId: req.params.workspaceId,
      category: v.category,
      sourceSystem: 'tally_export',
      externalId: v.externalId,
    };

    const existing = await CashItem.findOne(key);
    if (existing) {
      const settled = existing.settledPaise || 0;
      if (settled > v.amountPaise) {
        fail(409, 'CONFLICT', `Re-import for ${v.externalId} cannot reduce amount below settled balance`);
      }
      existing.counterparty = v.counterparty;
      existing.amountPaise = v.amountPaise;
      existing.dueDate = v.dueDate;
      existing.expectedDate = v.expectedDate;
      existing.confidenceState = 'verified';
      if (existing.status !== 'cancelled') {
        existing.status = settled >= v.amountPaise ? 'paid' : settled > 0 ? 'partial' : 'open';
      }
      await existing.save();
      createdItems.push(existing);
    } else {
      const saved = await CashItem.create({
        ...key,
        counterparty: v.counterparty,
        amountPaise: v.amountPaise,
        settledPaise: 0,
        status: 'open',
        dueDate: v.dueDate,
        expectedDate: v.expectedDate,
        confidenceState: 'verified',
      });
      createdItems.push(saved);
    }
  }

  await SyncBatch.create({
    workspaceId: req.params.workspaceId,
    companyId: parsed.companyName,
    batchId,
  });

  res.status(201).json({
    success: true,
    company: parsed.companyName,
    batchId,
    voucherCount: parsed.voucherCount,
    appliedCount: createdItems.length,
    vouchers: createdItems.map(item => ({
      id: String(item._id),
      externalId: item.externalId,
      counterparty: item.counterparty,
      category: item.category,
      amountPaise: item.amountPaise,
      dueDate: item.dueDate,
    })),
  });
}));

// POST Execute automated collection follow-up cycle
router.post('/run-cycle', asyncRoute(async (req, res) => {
  await workspaceOr404(req.params.workspaceId);
  const jobs = await runFollowups({ workspaceId: req.params.workspaceId, mode: 'demo' });
  res.json({
    success: true,
    executedAt: new Date().toISOString(),
    jobsProcessed: jobs.length,
    jobs,
  });
}));

export default router;
