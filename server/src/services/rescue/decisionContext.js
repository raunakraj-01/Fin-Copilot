import { bankReviewIssues } from '../finance/bankReview.js';
export function createDecisionContextLoader({ Workspace, CashItem, RecurringRule, BankTransaction, SyncBatch, ImportBatch }) {
  return async workspaceId => {
    const workspace = await Workspace.findById(workspaceId).lean();
    if (!workspace) return null;
    const [cashItems, recurringRules, bankRows, latestSync, latestImport] = await Promise.all([
      CashItem.find({ workspaceId }).lean(),
      RecurringRule.find({ workspaceId, active: true }).lean(),
      BankTransaction ? BankTransaction.find({ workspaceId, reviewState: 'open' }).lean() : [],
      SyncBatch ? SyncBatch.findOne({ workspaceId }).sort({ createdAt: -1 }).lean() : null,
      ImportBatch ? ImportBatch.findOne({ workspaceId, status: 'committed' }).sort({ updatedAt: -1 }).lean() : null,
    ]);
    const latestInputAt = [...cashItems.map(item => item.updatedAt),
      ...bankRows.map(item => item.updatedAt), latestImport?.updatedAt, latestSync?.createdAt]
      .filter(Boolean).map(value => new Date(value)).filter(value => Number.isFinite(value.valueOf()))
      .sort((a, b) => b - a)[0] || null;
    return {
      asOfDate: workspace.asOfDate, openingCashPaise: workspace.openingCashPaise,
      minimumReservePaise: workspace.minimumReservePaise ?? 0, horizonDays: 90,
      cashItems: cashItems.map(item => ({ ...item, id: String(item._id) })), recurringRules,
      ...(BankTransaction ? { bankReviewIssues: bankReviewIssues(bankRows) } : {}),
      latestInputAt: latestInputAt?.toISOString() || null,
      lastSuccessfulSyncAt: latestSync?.createdAt?.toISOString?.() || null,
      lastImportAt: latestImport?.updatedAt?.toISOString?.() || null,
    };
  };
}

// Resolve shared modules on request so isolated feature tests can inject dependencies.
export async function loadDecisionContext(workspaceId) {
  const [{ default: Workspace }, { default: CashItem }, { default: RecurringRule }, { default: BankTransaction },
    { default: SyncBatch }, { default: ImportBatch }] = await Promise.all([
    import('../../models/Workspace.js'), import('../../models/CashItem.js'), import('../../models/RecurringRule.js'),
    import('../../models/BankTransaction.js'), import('../../models/SyncBatch.js'), import('../../models/ImportBatch.js'),
  ]);
  return createDecisionContextLoader({ Workspace, CashItem, RecurringRule, BankTransaction, SyncBatch, ImportBatch })(workspaceId);
}
export async function loadSharedForecast() {
  const { buildForecast } = await import('../finance/forecast.js');
  return buildForecast;
}
