export function createDecisionContextLoader({ Workspace, CashItem, RecurringRule }) {
  return async workspaceId => {
    const workspace = await Workspace.findById(workspaceId).lean();
    if (!workspace) return null;
    const [cashItems, recurringRules] = await Promise.all([
      CashItem.find({ workspaceId }).lean(),
      RecurringRule.find({ workspaceId, active: true }).lean(),
    ]);
    return {
      asOfDate: workspace.asOfDate, openingCashPaise: workspace.openingCashPaise,
      minimumReservePaise: workspace.minimumReservePaise ?? 0, horizonDays: 90,
      cashItems: cashItems.map(item => ({ ...item, id: String(item._id) })), recurringRules,
    };
  };
}

// Resolve shared modules on request so isolated feature tests can inject dependencies.
export async function loadDecisionContext(workspaceId) {
  const [{ default: Workspace }, { default: CashItem }, { default: RecurringRule }] = await Promise.all([
    import('../../models/Workspace.js'), import('../../models/CashItem.js'), import('../../models/RecurringRule.js'),
  ]);
  return createDecisionContextLoader({ Workspace, CashItem, RecurringRule })(workspaceId);
}
export async function loadSharedForecast() {
  const { buildForecast } = await import('../finance/forecast.js');
  return buildForecast;
}
