import { randomUUID } from 'node:crypto';
import CollectionFollowUp from '../../models/CollectionFollowUp.js';
import CashItem from '../../models/CashItem.js';
import Workspace from '../../models/Workspace.js';
import { buildForecast } from './forecast.js';
import { makeCandidates, applyActions, actionFeeEvents } from '../rescue/analyze.js';
import CollectionAction from '../../models/CollectionAction.js';

const day = 86400000;
export const rupees = value => `INR ${(value / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const eligible = item => item?.category === 'receivable' && ['open', 'partial'].includes(item.status)
  && item.confidenceState !== 'needs_review' && item.amountPaise > (item.settledPaise || 0);

export function collectionMessage(item, asOfDate, attempt = 1, earlyAction) {
  const invoice = item.externalId || String(item.id || item._id);
  const amount = item.amountPaise - (item.settledPaise || 0);
  const prefix = attempt === 1 ? 'Hello' : attempt === 2 ? 'Hello, a friendly follow-up' : 'Hello, following up once more';
  if (earlyAction) return `${prefix} ${item.counterparty}, could you arrange ${rupees(earlyAction.amountPaise)} against invoice ${invoice} by ${earlyAction.toDate}? Please confirm whether this earlier payment is possible. Thank you.`;
  return `${prefix} ${item.counterparty}, our records as of ${asOfDate} show ${rupees(amount)} outstanding on invoice ${invoice}, due ${item.dueDate}. ${item.dueDate < asOfDate ? 'Could you confirm a payment date for this overdue balance?' : 'Could you confirm payment by the due date?'} If already paid, please share the payment reference. Thank you.`;
}

export function recommendCollections(context) {
  const forecast = buildForecast(context);
  const reserve = context.minimumReservePaise || 0;
  const gap = Math.max(0, reserve - forecast.risk.worstCashPaise);
  const actions = makeCandidates(context).filter(action => action.type === 'accelerate_collection');
  const suggestions = context.cashItems.filter(eligible).flatMap(item => {
    const id = String(item.id || item._id);
    const overdueDays = Math.max(0, Math.round((Date.parse(context.asOfDate) - Date.parse(item.dueDate)) / day));
    const daysUntilDue = Math.round((Date.parse(item.dueDate) - Date.parse(context.asOfDate)) / day);
    const action = actions.find(action => action.cashItemId === id);
    let gapReductionPaise = 0;
    if (action && gap > 0) {
      try {
        const after = buildForecast({ ...context, cashItems: applyActions(context, [action]), additionalEvents: actionFeeEvents(context, [action]) });
        gapReductionPaise = Math.max(0, gap - Math.max(0, reserve - after.risk.worstCashPaise));
      } catch { /* Invalid fee dates cannot justify a proactive early request. */ }
    }
    const kind = overdueDays > 0 ? 'overdue' : gapReductionPaise > 0 ? 'cash_shortage' : daysUntilDue >= 0 && daysUntilDue <= 7 ? 'due_soon' : null;
    if (!kind) return [];
    const earlyAction = kind === 'cash_shortage' ? action : null;
    return [{ cashItemId: id, externalId: item.externalId, counterparty: item.counterparty, kind, overdueDays,
      outstandingPaise: item.amountPaise - (item.settledPaise || 0), dueDate: item.dueDate,
      gapReductionPaise, reason: kind === 'overdue' ? `${overdueDays} day(s) overdue as of ${context.asOfDate}`
        : kind === 'due_soon' ? `Payment due in ${daysUntilDue} day(s)` : `Permitted early collection could reduce the peak cash gap by ${rupees(gapReductionPaise)}`,
      message: collectionMessage(item, context.asOfDate, 1, earlyAction) }];
  });
  return { asOfDate: context.asOfDate, firstNegativeDate: forecast.risk.firstNegativeDate,
    suggestions: suggestions.sort((a, b) => b.gapReductionPaise - a.gapReductionPaise || b.overdueDays - a.overdueDays || b.outstandingPaise - a.outstandingPaise) };
}

export const liveFollowupsEnabled = () => process.env.FOLLOWUP_ALLOW_SEND === '1';

async function currentMessage(rule) {
  const [item, workspace] = await Promise.all([
    CashItem.findOne({ _id: rule.cashItemId, workspaceId: rule.workspaceId }).lean(), Workspace.findById(rule.workspaceId).lean(),
  ]);
  if (!workspace || !eligible(item)) {
    rule.state = item?.status === 'paid' || item && item.settledPaise >= item.amountPaise ? 'paid' : 'unavailable';
    rule.claimId = null;
    rule.lastOutcome = 'Stopped: invoice is settled, unavailable, cancelled, or needs review';
    await rule.save();
    return null;
  }
  return { item, message: collectionMessage(item, workspace.asOfDate, rule.attempts + 1) };
}

export async function finishFollowup(claimId, outcome, providerMessageId, workspaceId) {
  const scope = workspaceId ? { workspaceId } : {};
  const rule = await CollectionFollowUp.findOne({ claimId, ...scope });
  if (!rule) return null;
  const attempts = rule.attempts + 1;
  // Atomic claim consumption makes repeated callbacks harmless.
  const finished = await CollectionFollowUp.findOneAndUpdate({ _id: rule._id, claimId, ...scope }, {
    $set: { claimId: null, attempts, state: rule.state !== 'active' ? rule.state : outcome === 'failed' ? 'paused' : attempts >= rule.maxAttempts ? 'exhausted' : 'active',
      nextRunAt: new Date(Date.now() + rule.cadenceDays * day), lastOutcome: outcome },
    $push: { history: { $each: [{ at: new Date(), message: rule.lastMessage, outcome, ...(providerMessageId ? { providerMessageId } : {}) }], $slice: -20 } },
  }, { new: true });
  if (finished && ['draft_ready', 'accepted', 'failed'].includes(outcome)) {
    await CollectionAction.updateOne({ workspaceId: rule.workspaceId, requestId: `followup:${claimId}` }, { $setOnInsert: {
      workspaceId: rule.workspaceId, cashItemId: rule.cashItemId, followUpId: rule._id, requestId: `followup:${claimId}`,
      type: outcome === 'draft_ready' ? 'reminder_draft' : 'reminder_sent', status: outcome === 'draft_ready' ? 'draft' : outcome,
      note: rule.lastMessage || '', ...(providerMessageId ? { providerMessageId } : {}),
    } }, { upsert: true });
  }
  return finished;
}

export async function runFollowups({ mode = 'demo', workspaceId, ruleId, now = new Date() } = {}) {
  if (mode === 'n8n' && !liveFollowupsEnabled()) return [];
  const query = { mode, state: 'active', claimId: null, nextRunAt: { $lte: now },
    ...(workspaceId ? { workspaceId } : {}), ...(ruleId ? { _id: ruleId } : {}), ...(mode === 'n8n' ? { recipientOptIn: true } : {}) };
  const due = await CollectionFollowUp.find(query).sort({ nextRunAt: 1 }).limit(10);
  const jobs = [];
  for (const dueRule of due) {
    const rule = await CollectionFollowUp.findOneAndUpdate({ ...query, _id: dueRule._id }, { $set: { claimId: randomUUID(), claimedAt: now, dispatchStartedAt: null } }, { new: true });
    if (!rule) continue;
    if (rule.attempts >= rule.maxAttempts) { rule.state = 'exhausted'; rule.claimId = null; await rule.save(); continue; }
    const current = await currentMessage(rule);
    if (!current) continue;
    rule.lastMessage = current.message;
    await rule.save();
    if (mode === 'demo') await finishFollowup(rule.claimId, 'draft_ready');
    else jobs.push({ claimId: rule.claimId, phone: rule.phone, message: current.message, invoice: current.item.externalId || String(current.item._id) });
  }
  return jobs;
}

export async function validateDispatch(claimId, workspaceId) {
  const rule = await CollectionFollowUp.findOne({ claimId, mode: 'n8n', state: 'active', recipientOptIn: true, ...(workspaceId ? { workspaceId } : {}) });
  if (!rule || !liveFollowupsEnabled()) return null;
  if (Date.now() - rule.claimedAt.getTime() > 10 * 60000) return null;
  const current = await currentMessage(rule);
  if (!current) return null;
  const granted = await CollectionFollowUp.findOneAndUpdate({ _id: rule._id, claimId, state: 'active', recipientOptIn: true, dispatchStartedAt: null },
    { $set: { lastMessage: current.message, dispatchStartedAt: new Date() } });
  if (!granted) return null;
  return { phone: rule.phone, message: current.message };
}

export async function reconcileFollowups() {
  const rules = await CollectionFollowUp.find({ state: 'active' }).select('_id cashItemId workspaceId').lean();
  if (!rules.length) return;
  const items = await CashItem.find({ _id: { $in: rules.map(rule => rule.cashItemId) } }).lean();
  for (const rule of rules) {
    const item = items.find(item => String(item._id) === String(rule.cashItemId) && String(item.workspaceId) === String(rule.workspaceId));
    if (!eligible(item)) await CollectionFollowUp.updateOne({ _id: rule._id, state: 'active' },
      { $set: { state: item?.status === 'paid' || item && item.settledPaise >= item.amountPaise ? 'paid' : 'unavailable', lastOutcome: 'Stopped: invoice no longer has an eligible outstanding balance' } });
  }
}

export function startFollowupWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileFollowups();
      // An expired external claim is uncertain, so pause it instead of risking duplicate sends.
      await CollectionFollowUp.updateMany({ state: 'active', claimId: { $ne: null }, claimedAt: { $lt: new Date(Date.now() - 10 * 60000) } },
        { $set: { state: 'paused', lastOutcome: 'Unknown send result. Check n8n before resuming.', claimId: null } });
      await runFollowups();
    } catch (error) { console.error('Follow-up draft worker:', error.message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 15000);
  timer.unref();
  return () => clearInterval(timer);
}
