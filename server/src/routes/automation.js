import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { generateMorningBrief } from '../services/automation/morningBrief.js';
import { morningBriefEnabled } from '../services/automation/morningBriefScheduler.js';
import { parseTallyXml } from '../services/imports/tallyXml.js';
import { runFollowups } from '../services/finance/followups.js';
import CashItem from '../models/CashItem.js';
import SyncBatch from '../models/SyncBatch.js';

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

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
    xmlString = req.file.buffer.toString('utf8');
  } else if (req.body && typeof req.body.xml === 'string') {
    xmlString = req.body.xml;
  } else if (typeof req.body === 'string') {
    xmlString = req.body;
  }

  if (!xmlString || !xmlString.includes('<ENVELOPE>')) {
    fail(400, 'VALIDATION_ERROR', 'Valid Tally XML with <ENVELOPE> header is required');
  }

  const parsed = parseTallyXml(xmlString);
  if (!parsed.vouchers || parsed.vouchers.length === 0) {
    fail(400, 'VALIDATION_ERROR', 'No valid financial vouchers found in Tally XML');
  }

  const batchId = crypto.randomUUID();
  const createdItems = [];

  for (const v of parsed.vouchers) {
    const key = {
      workspaceId: req.params.workspaceId,
      externalId: v.externalId,
    };

    const doc = {
      workspaceId: req.params.workspaceId,
      category: v.category,
      counterparty: v.counterparty,
      amountPaise: v.amountPaise,
      settledPaise: 0,
      status: 'open',
      dueDate: v.dueDate,
      expectedDate: v.expectedDate,
      sourceSystem: 'tally_export',
      confidenceState: 'verified',
      externalId: v.externalId,
    };

    const saved = await CashItem.findOneAndUpdate(key, { $set: doc }, { upsert: true, new: true });
    createdItems.push(saved);
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
