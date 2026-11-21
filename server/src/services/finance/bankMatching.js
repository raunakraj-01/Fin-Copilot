import BankTransaction from '../../models/BankTransaction.js';
import CashItem from '../../models/CashItem.js';
import { availablePaise } from '../imports/bank.js';
import { promiseState } from './promises.js';
import { fail } from '../../utils/http.js';
import CollectionAction from '../../models/CollectionAction.js';

// Reserve on the bank row first, then apply one idempotent invoice mutation. Pending
// reservations survive interrupted requests; retrying the same allocation finishes it.
// This works on the existing standalone MongoDB without a multi-document transaction.
export async function matchBankCredit(workspace, transactionId, input) {
  const transaction = await BankTransaction.findOne({ _id: transactionId, workspaceId: workspace._id }).lean();
  if (!transaction) fail(404, 'NOT_FOUND', 'Bank transaction not found');
  let allocation = transaction.allocations.find(a => a.requestId === input.requestId);
  if (allocation && ((allocation.direction || 'credit') !== 'credit' || String(allocation.cashItemId) !== input.cashItemId || allocation.amountPaise !== input.amountPaise || (allocation.promiseId || null) !== (input.promiseId || null)))
    fail(409, 'CONFLICT', 'This matching request ID was already used with different details');
  if (allocation?.status === 'applied') return { duplicate: true, requestId: allocation.requestId };
  if (allocation?.status === 'rejected') fail(409, 'MATCH_REJECTED', 'This allocation was rejected. Review its error and use a new request for a corrected match.');
  if (transaction.reviewState !== 'open' || !transaction.creditPaise) fail(400, 'VALIDATION_ERROR', 'Only open bank credits can be matched to customer invoices');
  if (!allocation) {
    if (transaction.allocations.some(a => a.status === 'pending')) fail(409, 'CONFLICT', 'Finish the pending match before creating another allocation on this credit');
    if (input.amountPaise > availablePaise(transaction)) fail(400, 'VALIDATION_ERROR', 'Match exceeds the bank credit’s unallocated amount');
    allocation = { ...input, direction: 'credit', promiseId: input.promiseId || null, status: 'pending', at: new Date() };
    const reserved = await BankTransaction.updateOne({ _id: transaction._id, workspaceId: workspace._id,
      version: transaction.version, reviewState: 'open', 'allocations.requestId': { $ne: input.requestId } },
    { $push: { allocations: allocation }, $inc: { version: 1 } });
    if (!reserved.modifiedCount) fail(409, 'CONFLICT', 'Bank credit changed. Refresh and retry the same match.');
  }
  const receiptKey = `bank:${transaction._id}:${allocation.requestId}`;
  async function finalize(status, error) {
    await BankTransaction.updateOne({ _id: transaction._id, workspaceId: workspace._id, allocations: { $elemMatch: { requestId: allocation.requestId, status: 'pending' } } },
      { $set: { 'allocations.$.status': status, 'allocations.$.error': error || '' }, $inc: { version: 1 } });
  }
  let item = await CashItem.findOne({ _id: input.cashItemId, workspaceId: workspace._id }).lean();
  if (item?.gatewayReceipts?.some(r => r.paymentOfferId === receiptKey)) {
    await finalize('applied');
    await CollectionAction.updateOne({ workspaceId: workspace._id, requestId: `bank:${transaction._id}:${input.requestId}` }, { $setOnInsert: {
      workspaceId: workspace._id, cashItemId: item._id, requestId: `bank:${transaction._id}:${input.requestId}`, type: 'receipt_confirmed',
      status: 'recorded', note: `Bank receipt ${transaction.transactionId}`, amountPaise: input.amountPaise, receivedDate: transaction.date,
    } }, { upsert: true });
    return { duplicate: true, requestId: input.requestId };
  }
  const reject = async message => { await finalize('rejected', message); fail(400, 'VALIDATION_ERROR', message); };
  if (!item || item.category !== 'receivable' || !['open', 'partial'].includes(item.status)) return reject('Select an open or partly paid customer invoice from this business');
  if (item.confidenceState === 'needs_review') return reject('Verify the invoice before matching a bank receipt');
  if (input.amountPaise > item.amountPaise - item.settledPaise) return reject('Match exceeds the invoice’s outstanding balance');
  const promises = item.paymentPromises || [];
  if (input.promiseId) {
    const promise = promises.find(p => String(p._id) === input.promiseId);
    if (!promise || promise.closedAs || input.amountPaise > promise.amountPaise - promise.receivedPaise) return reject('Select an active promise with enough unpaid balance on this invoice');
    promise.history.push({ action: 'receipt', at: new Date(), asOfDate: workspace.asOfDate, amountPaise: input.amountPaise,
      receivedDate: transaction.date, statusBefore: promiseState(promise, transaction.date > workspace.asOfDate ? transaction.date : workspace.asOfDate).status,
      note: `Bank match ${transaction.transactionId}`, requestId: input.requestId });
    promise.receivedPaise += input.amountPaise;
  }
  const settledPaise = item.settledPaise + input.amountPaise;
  const fields = { settledPaise, status: settledPaise === item.amountPaise ? 'paid' : 'partial' };
  if (input.promiseId) fields.paymentPromises = promises;
  if (item.constraints?.maxEarlyCollectionPaise != null) fields['constraints.maxEarlyCollectionPaise'] = Math.min(item.constraints.maxEarlyCollectionPaise, item.amountPaise - settledPaise);
  const updated = await CashItem.updateOne({ _id: item._id, workspaceId: workspace._id, category: 'receivable', status: item.status,
    amountPaise: item.amountPaise, settledPaise: item.settledPaise, confidenceState: item.confidenceState,
    'gatewayReceipts.paymentOfferId': { $ne: receiptKey },
    $or: [{ promiseVersion: item.promiseVersion || 0 }, ...(item.promiseVersion ? [] : [{ promiseVersion: { $exists: false } }])] },
  { $set: fields, $push: { gatewayReceipts: { paymentOfferId: receiptKey, amountPaise: input.amountPaise, date: transaction.date },
    settlementEvents: { source: 'bank', sourceId: receiptKey, direction: 'receipt', amountPaise: input.amountPaise, date: transaction.date,
      dueDate: item.dueDate, completedInvoice: settledPaise === item.amountPaise, verified: true, reference: transaction.transactionId } },
    $inc: { promiseVersion: 1, __v: 1 } }, { runValidators: true });
  if (!updated.modifiedCount) {
    item = await CashItem.findOne({ _id: input.cashItemId, workspaceId: workspace._id }).lean();
    if (!item?.gatewayReceipts?.some(r => r.paymentOfferId === receiptKey))
      fail(409, 'CONFLICT', 'Invoice changed. This bank amount remains reserved. Refresh and retry the same pending match.');
  }
  await finalize('applied');
  await CollectionAction.updateOne({ workspaceId: workspace._id, requestId: `bank:${transaction._id}:${input.requestId}` }, { $setOnInsert: {
    workspaceId: workspace._id, cashItemId: item._id, requestId: `bank:${transaction._id}:${input.requestId}`, type: 'receipt_confirmed',
    status: 'recorded', note: `Bank receipt ${transaction.transactionId}`, amountPaise: input.amountPaise, receivedDate: transaction.date,
  } }, { upsert: true });
  return { requestId: input.requestId, cashItemId: input.cashItemId, amountPaise: input.amountPaise };
}

export async function matchBankDebit(workspace, transactionId, input) {
  const { availableDebitPaise } = await import('../imports/bank.js');
  const transaction = await BankTransaction.findOne({ _id: transactionId, workspaceId: workspace._id }).lean();
  if (!transaction) fail(404, 'NOT_FOUND', 'Bank transaction not found');
  let allocation = transaction.allocations.find(value => value.requestId === input.requestId);
  if (allocation && (allocation.direction !== 'debit' || String(allocation.cashItemId) !== input.cashItemId || allocation.amountPaise !== input.amountPaise))
    fail(409, 'CONFLICT', 'This matching request ID was already used with different details');
  if (allocation?.status === 'applied') return { duplicate: true, requestId: allocation.requestId };
  if (allocation?.status === 'rejected') fail(409, 'MATCH_REJECTED', 'This allocation was rejected. Use a new request after reviewing the error.');
  if (transaction.reviewState !== 'open' || !transaction.debitPaise) fail(400, 'VALIDATION_ERROR', 'Only open bank debits can be matched to supplier payments or expenses');
  if (!allocation) {
    if (transaction.allocations.some(a => a.status === 'pending')) fail(409, 'CONFLICT', 'Finish the pending match before creating another allocation');
    if (input.amountPaise > availableDebitPaise(transaction)) fail(400, 'VALIDATION_ERROR', 'Match exceeds the unallocated bank debit');
    allocation = { ...input, direction: 'debit', promiseId: null, status: 'pending', at: new Date() };
    const reserved = await BankTransaction.updateOne({ _id: transaction._id, workspaceId: workspace._id, version: transaction.version,
      reviewState: 'open', 'allocations.requestId': { $ne: input.requestId } }, { $push: { allocations: allocation }, $inc: { version: 1 } });
    if (!reserved.modifiedCount) fail(409, 'CONFLICT', 'Bank debit changed. Refresh and retry the same match.');
  }
  const settlementKey = `bank-debit:${transaction._id}:${allocation.requestId}`;
  const finalize = async (status, error = '') => BankTransaction.updateOne({ _id: transaction._id, workspaceId: workspace._id,
    allocations: { $elemMatch: { requestId: allocation.requestId, status: 'pending' } } },
  { $set: { 'allocations.$.status': status, 'allocations.$.error': error }, $inc: { version: 1 } });
  let item = await CashItem.findOne({ _id: input.cashItemId, workspaceId: workspace._id }).lean();
  if (item?.settlementEvents?.some(event => event.sourceId === settlementKey)) { await finalize('applied'); return { duplicate: true, requestId: input.requestId }; }
  const reject = async message => { await finalize('rejected', message); fail(400, 'VALIDATION_ERROR', message); };
  if (!item || !['payable', 'expense'].includes(item.category) || !['open', 'partial'].includes(item.status)) return reject('Select an open or partly paid supplier bill or expense from this business');
  if (item.confidenceState === 'needs_review') return reject('Verify the ledger record before matching a bank payment');
  if (input.amountPaise > item.amountPaise - item.settledPaise) return reject('Match exceeds the ledger record’s outstanding balance');
  const settledPaise = item.settledPaise + input.amountPaise;
  const updated = await CashItem.updateOne({ _id: item._id, workspaceId: workspace._id, category: item.category, status: item.status,
    amountPaise: item.amountPaise, settledPaise: item.settledPaise, confidenceState: item.confidenceState,
    'settlementEvents.sourceId': { $ne: settlementKey } }, { $set: { settledPaise, status: settledPaise === item.amountPaise ? 'paid' : 'partial' },
    $push: { settlementEvents: { source: 'bank', sourceId: settlementKey, direction: 'payment', amountPaise: input.amountPaise,
      date: transaction.date, dueDate: item.dueDate, completedInvoice: settledPaise === item.amountPaise, verified: true, reference: transaction.transactionId } }, $inc: { __v: 1 } });
  if (!updated.modifiedCount) {
    item = await CashItem.findOne({ _id: input.cashItemId, workspaceId: workspace._id }).lean();
    if (!item?.settlementEvents?.some(event => event.sourceId === settlementKey)) fail(409, 'CONFLICT', 'Ledger record changed. The bank amount remains reserved; refresh and retry the pending match.');
  }
  await finalize('applied');
  return { requestId: input.requestId, cashItemId: input.cashItemId, amountPaise: input.amountPaise };
}
