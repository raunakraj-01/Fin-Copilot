import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asyncRoute, fail, validate, workspaceOr404 } from '../utils/http.js';
import { dateOnly } from '../validators/finance.js';
import CashItem from '../models/CashItem.js';
import { quoteDiscount } from '../services/finance/discount.js';
import { loadDecisionContext } from '../services/rescue/decisionContext.js';
import { buildForecast } from '../services/finance/forecast.js';
import PaymentOffer from '../models/PaymentOffer.js';
import { requireOwner as checkOwner } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
const input = z.object({ cashItemId: z.string().regex(/^[a-f\d]{24}$/i), amountPaise: z.number().int().safe().positive().optional(), discountBps: z.number().int().min(0).max(10000),
  settleBy: dateOnly, phone: z.string().regex(/^\+?\d{10,15}$/, 'Use 10–15 digits; a leading + is optional').transform(value => value.replace(/^\+/, '')) }).strict();
export function requireOwner(req) {
  checkOwner(req);
}
async function prepareOffer(req) {
  requireOwner(req);
  const workspace = await workspaceOr404(req.params.workspaceId);
  const data = validate(input, req.body);
  const item = await CashItem.findOne({ _id: data.cashItemId, workspaceId: workspace._id, category: 'receivable', status: { $in: ['open', 'partial'] } });
  if (!item) fail(404, 'NOT_FOUND', 'Open receivable not found');
  if (!item.expectedDate || data.settleBy <= workspace.asOfDate || data.settleBy >= item.expectedDate) fail(400, 'VALIDATION_ERROR', 'Settlement date must be after snapshot and before expected collection');
  if (item.constraints?.earliestCollectionDate && data.settleBy < item.constraints.earliestCollectionDate) fail(400, 'VALIDATION_ERROR', 'Date violates earliest collection constraint');
  const outstandingPaise = item.amountPaise - item.settledPaise;
  const amountPaise = data.amountPaise ?? Math.min(outstandingPaise, item.constraints?.maxEarlyCollectionPaise ?? outstandingPaise);
  if (amountPaise > outstandingPaise || (item.constraints?.maxEarlyCollectionPaise != null && amountPaise > item.constraints.maxEarlyCollectionPaise)) fail(400, 'VALIDATION_ERROR', 'Offer exceeds early collection limit');
  const quote = quoteDiscount(amountPaise, data.discountBps);
  return { workspace, data, item, amountPaise, quote, outstandingPaise };
}
router.post('/preview', asyncRoute(async (req, res) => {
  const { workspace, data, item, amountPaise, quote, outstandingPaise } = await prepareOffer(req);
  const context = await loadDecisionContext(req.params.workspaceId);
  const baseline = buildForecast(context);
  const updatedItems = context.cashItems.map(record => String(record._id) === String(item._id)
    ? { ...record, amountPaise: record.amountPaise - amountPaise } : record);
  const additionalEvents = [{ id: 'offer-net-receipt', date: data.settleBy, direction: 'in', amountPaise: quote.buyerPaysPaise }];
  const feePaise = item.constraints?.estimatedActionCostPaise ?? 0;
  if (feePaise) additionalEvents.push({ id: 'offer-fee', date: item.constraints.actionCostDate || data.settleBy, direction: 'out', amountPaise: feePaise });
  const simulated = buildForecast({ ...context, cashItems: updatedItems, additionalEvents });
  const inr = paise => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
  const text = `Hello, could you settle INR ${inr(amountPaise)} of invoice ${item.externalId || item._id} by ${data.settleBy}? With the proposed ${data.discountBps / 100}% early-payment discount, the amount would be INR ${inr(quote.buyerPaysPaise)}. Please confirm before paying.`;
  res.json({ ...quote, cashItemId: String(item._id), settleBy: data.settleBy, recipientPhone: data.phone, message: text,
    feePaise, remainingOutstandingPaise: outstandingPaise - amountPaise,
    forecast: { baselineWorstCashPaise: baseline.risk.worstCashPaise, simulatedWorstCashPaise: simulated.risk.worstCashPaise,
      baselineFirstNegativeDate: baseline.risk.firstNegativeDate, simulatedFirstNegativeDate: simulated.risk.firstNegativeDate },
    whatsappUrl: `https://wa.me/${data.phone}?text=${encodeURIComponent(text)}`, status: 'draft',
    desktopUrl: `whatsapp://send?phone=${data.phone}&text=${encodeURIComponent(text)}`,
    warning: 'Draft only. No payment link, message delivery, or settlement is recorded.' });
}));
router.post('/payment-link', asyncRoute(async (req, res) => {
  const { workspace, data, item, amountPaise, quote } = await prepareOffer(req);
  const { RAZORPAY_KEY_ID: key, RAZORPAY_KEY_SECRET: secret, RAZORPAY_WEBHOOK_SECRET: webhookSecret } = process.env;
  if (!key?.startsWith('rzp_test_') || !secret || !webhookSecret) fail(503, 'PAYMENTS_UNAVAILABLE', 'Set Razorpay test API and webhook credentials on the server');
  if (data.settleBy < new Date().toISOString().slice(0, 10) || quote.buyerPaysPaise < 100) fail(400, 'VALIDATION_ERROR', 'Payment link needs a future date and at least INR 1 due');
  const offer = await PaymentOffer.create({ workspaceId: workspace._id, cashItemId: item._id,
    grossPaise: amountPaise, buyerPaysPaise: quote.buyerPaysPaise, discountPaise: quote.discountPaise,
    settleBy: data.settleBy, referenceId: randomUUID() });
  let response;
  try {
    response = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: quote.buyerPaysPaise, currency: 'INR', accept_partial: false,
        reference_id: offer.referenceId, description: `Early settlement of invoice ${item.externalId || item._id}`,
        customer: { name: item.counterparty, contact: `+${data.phone}` }, notify: { sms: false, email: false },
        expire_by: Math.floor(Date.parse(`${data.settleBy}T23:59:59+05:30`) / 1000) }),
    });
  } catch (error) {
    console.error('[Offers] Razorpay payment link request error:', error);
    await PaymentOffer.deleteOne({ _id: offer._id, status: 'creating' });
    fail(502, 'PAYMENT_LINK_FAILED', 'Could not reach Razorpay to create the payment link');
  }
  const link = await response.json().catch(() => ({}));
  if (!response.ok || !/^plink_[A-Za-z0-9]+$/.test(link.id || '') || !/^https:\/\//.test(link.short_url || '')) {
    console.error('[Offers] Razorpay rejected payment link creation:', link.error || response.status);
    await PaymentOffer.deleteOne({ _id: offer._id, status: 'creating' });
    fail(502, 'PAYMENT_LINK_FAILED', 'Razorpay did not create a valid payment link');
  }
  offer.gatewayLinkId = link.id; offer.paymentUrl = link.short_url; offer.status = 'created'; await offer.save();
  res.status(201).json({ id: String(offer._id), paymentUrl: offer.paymentUrl, status: offer.status,
    message: `Hello, could you settle INR ${(amountPaise / 100).toFixed(2)} of invoice ${item.externalId || item._id} by ${data.settleBy}? With the ${data.discountBps / 100}% early-payment discount, pay INR ${(quote.buyerPaysPaise / 100).toFixed(2)} here: ${offer.paymentUrl}` });
}));
router.get('/payment-link/:offerId', asyncRoute(async (req, res) => {
  requireOwner(req);
  await workspaceOr404(req.params.workspaceId);
  if (!/^[a-f\d]{24}$/i.test(req.params.offerId)) fail(400, 'VALIDATION_ERROR', 'Invalid offer ID');
  const offer = await PaymentOffer.findOne({ _id: req.params.offerId, workspaceId: req.params.workspaceId }).lean();
  if (!offer) fail(404, 'NOT_FOUND', 'Payment offer not found');
  const forecast = offer.status === 'paid' ? buildForecast(await loadDecisionContext(req.params.workspaceId)) : null;
  res.json({ id: String(offer._id), status: offer.status, paidAt: offer.paidAt || null,
    worstCashPaise: forecast?.risk.worstCashPaise ?? null });
}));
export default router;
