import { bankReviewIssues } from '../finance/bankReview.js';
export function createDecisionContextLoader({ Workspace, CashItem, RecurringRule, BankTransaction }) {
  return async workspaceId => {
    const workspace = await Workspace.findById(workspaceId).lean();
    if (!workspace) return null;
    const [cashItems, recurringRules, bankRows] = await Promise.all([
      CashItem.find({ workspaceId }).lean(),
      RecurringRule.find({ workspaceId, active: true }).lean(),
      BankTransaction ? BankTransaction.find({ workspaceId, reviewState: 'open' }).lean() : [],
    ]);
    return {
      asOfDate: workspace.asOfDate, openingCashPaise: workspace.openingCashPaise,
      minimumReservePaise: workspace.minimumReservePaise ?? 0, horizonDays: 90,
      cashItems: cashItems.map(item => ({ ...item, id: String(item._id) })), recurringRules,
      ...(BankTransaction ? { bankReviewIssues: bankReviewIssues(bankRows) } : {}),
    };
  };
}

// Resolve shared modules on request so isolated feature tests can inject dependencies.
export async function loadDecisionContext(workspaceId) {
  const [{ default: Workspace }, { default: CashItem }, { default: RecurringRule }, { default: BankTransaction }] = await Promise.all([
    import('../../models/Workspace.js'), import('../../models/CashItem.js'), import('../../models/RecurringRule.js'),
    import('../../models/BankTransaction.js'),
  ]);
  return createDecisionContextLoader({ Workspace, CashItem, RecurringRule, BankTransaction })(workspaceId);
}
export async function loadSharedForecast() {
  const { buildForecast } = await import('../finance/forecast.js');
  return buildForecast;
}
