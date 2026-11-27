import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import PaymentOffer from '../models/PaymentOffer.js';
import CashItem from '../models/CashItem.js';
import { asyncRoute, fail } from '../utils/http.js';
import CollectionAction from '../models/CollectionAction.js';
import { appendAudit } from '../services/audit.js';

const router = Router();
router.post('/', asyncRoute(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.get('X-Razorpay-Signature') || '';
  if (!secret || !/^[a-f\d]{64}$/i.test(signature) || !Buffer.isBuffer(req.body)) fail(401, 'UNAUTHORIZED', 'Invalid webhook signature');
  const expected = createHmac('sha256', secret).update(req.body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) fail(401, 'UNAUTHORIZED', 'Invalid webhook signature');
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { fail(400, 'VALIDATION_ERROR', 'Invalid webhook JSON'); }
  if (event.event !== 'payment_link.paid') return res.status(200).json({ received: true });
  const link = event.payload?.payment_link?.entity;
  const payment = event.payload?.payment?.entity;
  if (!link || !payment || link.status !== 'paid' || payment.status !== 'captured'
    || link.currency !== 'INR' || payment.currency !== 'INR'
    || !Number.isSafeInteger(link.amount_paid) || link.amount_paid !== payment.amount) fail(400, 'VALIDATION_ERROR', 'Invalid paid event');
  const offer = await PaymentOffer.findOne({ gatewayLinkId: link.id, referenceId: link.reference_id });
  if (!offer || link.amount !== offer.buyerPaysPaise || link.amount_paid !== offer.buyerPaysPaise) fail(409, 'PAYMENT_MISMATCH', 'Payment link does not match offer');
  const { RAZORPAY_KEY_ID: key, RAZORPAY_KEY_SECRET: apiSecret } = process.env;
  if (!/^rzp_(?:test|live)_/.test(key || '') || !apiSecret) fail(503, 'PAYMENTS_UNAVAILABLE', 'Razorpay credentials are unavailable');
  let verified;
  try {
    const response = await fetch(`https://api.razorpay.com/v1/payment_links/${offer.gatewayLinkId}`, {
      signal: AbortSignal.timeout(3000), headers: { Authorization: `Basic ${Buffer.from(`${key}:${apiSecret}`).toString('base64')}` },
    });
    if (response.ok) verified = await response.json();
  } catch { /* Razorpay will retry the webhook. */ }
  if (verified?.status !== 'paid' || verified.id !== offer.gatewayLinkId || verified.reference_id !== offer.referenceId
    || verified.currency !== 'INR' || verified.amount !== offer.buyerPaysPaise || verified.amount_paid !== offer.buyerPaysPaise) {
    fail(503, 'PAYMENT_UNVERIFIED', 'Could not confirm this payment with Razorpay');
  }
  const date = new Date(event.created_at * 1000);
  if (!Number.isFinite(date.getTime())) fail(400, 'VALIDATION_ERROR', 'Invalid payment timestamp');
  const receipt = { paymentOfferId: String(offer._id), amountPaise: offer.buyerPaysPaise, date: date.toISOString().slice(0, 10) };
  const currentItem = await CashItem.findOne({ _id: offer.cashItemId, workspaceId: offer.workspaceId, category: 'receivable' }).lean();
  if (!currentItem) fail(409, 'SETTLEMENT_CONFLICT', 'Invoice cannot accept this settlement');
  let result = { modifiedCount: 0 };
  if (!currentItem.gatewayReceipts.some(row => row.paymentOfferId === receipt.paymentOfferId)) {
    if (!['open', 'partial'].includes(currentItem.status)) fail(409, 'SETTLEMENT_CONFLICT', 'Invoice cannot accept this settlement');
    result = await CashItem.updateOne({ _id: offer.cashItemId, workspaceId: offer.workspaceId,
      category: 'receivable', status: { $in: ['open', 'partial'] }, 'gatewayReceipts.paymentOfferId': { $ne: receipt.paymentOfferId },
      $expr: { $gte: [{ $subtract: ['$amountPaise', '$settledPaise'] }, offer.grossPaise] } },
    { $inc: { settledPaise: offer.grossPaise, __v: 1, promiseVersion: 1 }, $push: { gatewayReceipts: receipt, settlementEvents: {
      source: 'gateway', sourceId: receipt.paymentOfferId, direction: 'receipt', amountPaise: offer.grossPaise, date: receipt.date,
      dueDate: currentItem.dueDate, completedInvoice: currentItem.settledPaise + offer.grossPaise === currentItem.amountPaise, verified: true, reference: offer.gatewayLinkId } } });
  }
  const item = await CashItem.findById(offer.cashItemId);
  if (!result.modifiedCount && !item?.gatewayReceipts.some(row => row.paymentOfferId === receipt.paymentOfferId)) fail(409, 'SETTLEMENT_CONFLICT', 'Invoice cannot accept this settlement');
  if (result.modifiedCount) { item.status = item.settledPaise === item.amountPaise ? 'paid' : 'partial'; await item.save(); }
  if (offer.status !== 'paid') { offer.status = 'paid'; offer.paidAt = receipt.date; await offer.save(); }
  if (result.modifiedCount || offer.status !== 'paid') {
    await CollectionAction.updateOne({ workspaceId: offer.workspaceId, requestId: `gateway:${offer._id}` }, { $setOnInsert: {
      workspaceId: offer.workspaceId, cashItemId: offer.cashItemId, requestId: `gateway:${offer._id}`, type: 'receipt_confirmed',
      status: 'recorded', note: `Razorpay payment confirmed for ${offer.gatewayLinkId}`, amountPaise: offer.grossPaise, receivedDate: receipt.date,
    } }, { upsert: true });
    await appendAudit({ workspaceId: offer.workspaceId, action: 'payment.confirmed', entityType: 'cash_item', entityId: String(offer.cashItemId) });
  }
  res.json({ received: true });
}));
export default router;
