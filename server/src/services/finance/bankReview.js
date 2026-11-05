import { availablePaise } from '../imports/bank.js';
export function bankReviewIssues(transactions) {
  return transactions.filter(t => t.reviewState === 'open').flatMap(t => {
    const pending = t.allocations.filter(a => a.status === 'pending').reduce((sum, a) => sum + a.amountPaise, 0);
    const amountPaise = t.debitPaise || availablePaise(t) + pending;
    if (!amountPaise) return [];
    return [{ transactionId: String(t._id), amountPaise, kind: pending ? 'pending_match' : t.creditPaise ? 'unmatched_credit' : 'unreviewed_debit',
      message: `Bank transaction ${t.transactionId}: ${pending ? 'a matching allocation is pending' : t.creditPaise ? 'a credit remains unmatched' : 'a debit needs review against cash records'}. Match it or review the unmatched amount before relying on the forecast.` }];
  });
}
