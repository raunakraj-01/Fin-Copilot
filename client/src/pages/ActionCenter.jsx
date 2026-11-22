import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, json } from '../services/api.js';
import ProactiveCollections from '../components/ProactiveCollections.jsx';
import WhatsAppCaptureDesk from '../components/WhatsAppCaptureDesk.jsx';
import ProcurementDesk from '../components/ProcurementDesk.jsx';
import FulfillmentDesk from '../components/FulfillmentDesk.jsx';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((value || 0) / 100);
const todayIndia = () => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const daysAfter = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const emptyInventory = { name: '', sku: '', unit: 'units', supplier: '', quantityOnHand: '', reorderPoint: '', reorderQuantity: '', leadTimeDays: '7', unitCostRupees: '' };

function ActionCard({ title, count, children, action, onAction, tone = 'normal' }) {
  return <article className={`action-card action-card-${tone}`}>
    <div className="action-card-head"><h3>{title}</h3>{count > 0 && <span className="action-count">{count}</span>}</div>
    {children}{action && <button type="button" className="secondary" onClick={onAction}>{action}</button>}
  </article>;
}

export default function ActionCenter({ workspaceId, businessRole = 'owner', onNavigate, onCaptureApproved }) {
  const [data, setData] = useState(null);
  const [inventoryForm, setInventoryForm] = useState(emptyInventory);
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [busyItem, setBusyItem] = useState('');
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const [paymentBusy, setPaymentBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [workflowRefreshKey, setWorkflowRefreshKey] = useState(0);
  const currentWorkspace = useRef(workspaceId);
  currentWorkspace.current = workspaceId;
  const today = todayIndia();

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError('');
    const paths = [
      `/workspaces/${workspaceId}`, `/workspaces/${workspaceId}/forecast`, `/workspaces/${workspaceId}/items`,
      `/workspaces/${workspaceId}/bank?offset=0`, `/workspaces/${workspaceId}/promises`,
      `/workspaces/${workspaceId}/orders/scenarios`, `/workspaces/${workspaceId}/inventory`,
      `/workspaces/${workspaceId}/sync/status`, `/workspaces/${workspaceId}/sync/changes`,
      ...(businessRole === 'owner' ? [`/workspaces/${workspaceId}/captures`, `/workspaces/${workspaceId}/procurement`, `/workspaces/${workspaceId}/fulfillment`] : [null, null, null]),
    ];
    const results = await Promise.all(paths.map(path => path ? api(path).catch(() => null) : Promise.resolve(null)));
    if (currentWorkspace.current !== workspaceId) return;
    setData({ workspace: results[0]?.workspace, forecast: results[1], items: results[2]?.items || [], bank: results[3],
      promises: results[4], scenarios: results[5]?.scenarios || [], inventory: results[6]?.items || [],
      sync: results[7], syncChanges: results[8]?.changes || [], captures: results[9]?.captures || [],
      procurement: results[10]?.requests || [], fulfillment: results[11]?.orders || [] });
    setWorkflowRefreshKey(value => value + 1);
    if (!results[0] || !results[1] || !results[2]) setError('Some action signals could not load. Refresh or check the workspace connection.');
  }, [workspaceId, businessRole]);

  useEffect(() => {
    setData(null); setError(''); setMessage(''); setNotificationEnabled(localStorage.getItem(`cashflowDailyAlert:${workspaceId}`) === '1');
    refresh().catch(cause => setError(cause.message));
    const timer = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 60000);
    const onFocus = () => refresh().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [workspaceId, refresh]);

  const items = data?.items || [];
  const snapshot = data?.workspace?.asOfDate || data?.forecast?.asOfDate || today;
  const open = items.filter(item => ['open', 'partial'].includes(item.status));
  const collections = open.filter(item => item.category === 'receivable' && item.confidenceState !== 'needs_review');
  const dueCollections = collections.filter(item => item.expectedDate && item.expectedDate <= daysAfter(snapshot, 7));
  const duePayables = open.filter(item => ['payable', 'expense'].includes(item.category)
    && (item.dueDate || item.expectedDate) && (item.dueDate || item.expectedDate) <= daysAfter(snapshot, 7))
    .sort((a, b) => (a.dueDate || a.expectedDate).localeCompare(b.dueDate || b.expectedDate));
  const needsReview = items.filter(item => ['open', 'partial'].includes(item.status)
    && (item.confidenceState === 'needs_review' || !item.expectedDate));
  const bankRows = data?.bank?.transactions || [];
  const unresolvedBank = bankRows.filter(row => row.reviewState !== 'excluded' && (row.availablePaise > 0 || row.availableDebitPaise > 0));
  const promiseIssues = (data?.promises?.items || []).flatMap(item => (item.promises || []).filter(promise => ['broken', 'review_external_settlement'].includes(promise.status))
    .map(promise => ({ item, promise })));
  const staleScenarios = (data?.scenarios || []).filter(scenario => scenario.freshness?.stale);
  const activeOrders = (data?.scenarios || []).filter(scenario => !['prospective', 'completed', 'cancelled'].includes(scenario.trackingStatus || 'prospective'));
  const orderFollowups = activeOrders.filter(scenario => scenario.trackingStatus === 'awaiting_collection' && scenario.finalCollectionDate <= snapshot);
  const lowStock = (data?.inventory || []).filter(item => item.atReorderPoint);
  const pendingCaptures = (data?.captures || []).filter(capture => capture.status === 'pending');
  const procurementNeedsReview = (data?.procurement || []).filter(request => ['draft', 'quote_received'].includes(request.status));
  const procurementDue = (data?.procurement || []).filter(request => ['approved', 'ordered', 'received'].includes(request.status)
    && request.paymentDueDate && request.paymentDueDate <= daysAfter(snapshot, 7));
  const fulfillmentInProgress = (data?.fulfillment || []).filter(order => ['accepted', 'in_production', 'ready_to_dispatch'].includes(order.status));
  const deliveryDue = fulfillmentInProgress.filter(order => order.expectedDeliveryDate <= snapshot);
  const collectionDue = (data?.fulfillment || []).filter(order => order.status === 'delivered' && order.invoiceCashItemId
    && order.finalCollectionDate <= daysAfter(snapshot, 7)
    && items.some(item => item.id === order.invoiceCashItemId && ['open', 'partial'].includes(item.status)));
  const risk = data?.forecast?.risk;
  const cashWarning = risk?.firstReserveBreachDate || risk?.firstNegativeDate;
  const negativeComesFirst = Boolean(risk?.firstNegativeDate && (!risk.firstReserveBreachDate || risk.firstNegativeDate <= risk.firstReserveBreachDate));
  const lastSyncAt = data?.sync?.lastSuccessfulAt ? new Date(data.sync.lastSuccessfulAt) : null;
  const syncStale = lastSyncAt && Number.isFinite(lastSyncAt.valueOf()) && (Date.now() - lastSyncAt.valueOf()) > 2 * 86400000;
  const ledgerStale = data?.forecast?.dataFreshness?.stale === true;
  const syncSummary = businessRole !== 'owner' ? 'sync status is visible to the business owner'
    : data?.sync?.latestRun ? `${data.sync.latestRun.status} · ${data.sync.latestRun.appliedCount} applied · ${data.sync.latestRun.pendingCount} pending` : 'no sync run recorded';
  const alerts = useMemo(() => {
    const rows = [];
    if (cashWarning) rows.push(`Cash reserve risk on ${cashWarning}`);
    if (dueCollections.length) rows.push(`${dueCollections.length} customer invoice(s) due or overdue`);
    if (duePayables.length) rows.push(`${duePayables.length} supplier payment(s) due soon`);
    if (unresolvedBank.length) rows.push(`${unresolvedBank.length} bank transaction(s) need matching or review`);
    if (needsReview.length) rows.push(`${needsReview.length} invoice/bill record(s) need review`);
    if (promiseIssues.length) rows.push(`${promiseIssues.length} payment promise(s) are broken or need review`);
    if (staleScenarios.length) rows.push(`${staleScenarios.length} saved order analysis result(s) are outdated`);
    if (orderFollowups.length) rows.push(`${orderFollowups.length} accepted order(s) have a final collection date to follow up`);
    if (lowStock.length) rows.push(`${lowStock.length} stock item(s) reached their reorder point`);
    if (pendingCaptures.length) rows.push(`${pendingCaptures.length} WhatsApp message(s) need owner review`);
    if (procurementNeedsReview.length) rows.push(`${procurementNeedsReview.length} supplier purchase(s) need a quote or cash approval`);
    if (procurementDue.length) rows.push(`${procurementDue.length} supplier cash commitment date(s) are due within 7 days`);
    if (deliveryDue.length) rows.push(`${deliveryDue.length} tracked order(s) reached their expected delivery date`);
    if (collectionDue.length) rows.push(`${collectionDue.length} delivered order invoice(s) reach collection date within 7 days`);
    if (data?.sync?.actionableError || data?.syncChanges.length || syncStale) rows.push('Tally sync needs attention');
    if (ledgerStale) rows.push(`Cash records have not changed for ${data?.forecast?.dataFreshness?.staleDays || 'several'} days`);
    return rows;
  }, [cashWarning, dueCollections.length, duePayables.length, unresolvedBank.length, needsReview.length, promiseIssues.length,
    staleScenarios.length, orderFollowups.length, lowStock.length, pendingCaptures.length, procurementNeedsReview.length,
    procurementDue.length, deliveryDue.length, collectionDue.length, data?.sync?.actionableError, data?.syncChanges.length,
    syncStale, ledgerStale, data?.forecast?.dataFreshness?.staleDays]);

  const digest = useMemo(() => {
    const lines = [`CashFlow Copilot daily briefing · ${data?.workspace?.name || 'Business'} · snapshot ${snapshot}`];
    if (cashWarning) lines.push(`Cash: review forecast risk on ${cashWarning}.`);
    else lines.push('Cash: no negative balance or reserve breach found in the current forecast.');
    if (dueCollections.length) lines.push(`Collections: ${dueCollections.length} invoice(s) due or overdue.`);
    if (duePayables.length) lines.push(`Payables: ${duePayables.length} bill(s) due within 7 days of the workspace snapshot.`);
    if (unresolvedBank.length) lines.push(`Bank: ${unresolvedBank.length} transaction(s) need matching or review.`);
    if (needsReview.length) lines.push(`Data: ${needsReview.length} record(s) need date/balance review.`);
    if (promiseIssues.length) lines.push(`Promises: ${promiseIssues.length} broken or conflicted promise(s).`);
    if (staleScenarios.length) lines.push(`Orders: ${staleScenarios.length} saved analysis result(s) should be recalculated.`);
    if (orderFollowups.length) lines.push(`Order follow-up: ${orderFollowups.length} accepted order(s) have reached their final collection date.`);
    if (lowStock.length) lines.push(`Stock: ${lowStock.length} item(s) reached the reorder point.`);
    if (pendingCaptures.length) lines.push(`WhatsApp: ${pendingCaptures.length} customer message(s) are waiting for owner review.`);
    if (procurementNeedsReview.length) lines.push(`Procurement: ${procurementNeedsReview.length} request(s) need a supplier quote or cash approval.`);
    if (procurementDue.length) lines.push(`Procurement: ${procurementDue.length} supplier cash commitment date(s) fall within the next 7 days.`);
    if (deliveryDue.length) lines.push(`Delivery: ${deliveryDue.length} tracked order(s) reached their expected delivery date.`);
    if (collectionDue.length) lines.push(`Collections: ${collectionDue.length} delivered order invoice(s) reach their collection date within 7 days.`);
    if (data?.sync?.actionableError || data?.syncChanges.length || syncStale) lines.push('Tally: sync error, pending changes, or stale sync needs attention.');
    if (ledgerStale) lines.push(`Data freshness: no cash-record changes for ${data?.forecast?.dataFreshness?.staleDays || 'several'} days; confirm recent activity was imported.`);
    if (lines.length === 2) lines.push('No immediate action items found.');
    return lines.join('\n');
  }, [data?.workspace?.name, snapshot, cashWarning, dueCollections.length, duePayables.length, unresolvedBank.length,
    needsReview.length, promiseIssues.length, staleScenarios.length, orderFollowups.length, lowStock.length, pendingCaptures.length,
    procurementNeedsReview.length, procurementDue.length, deliveryDue.length, collectionDue.length, data?.sync?.actionableError,
    data?.syncChanges.length, syncStale, ledgerStale, data?.forecast?.dataFreshness?.staleDays]);

  useEffect(() => {
    if (!data || !notificationEnabled || !alerts.length || !('Notification' in window) || Notification.permission !== 'granted') return;
    const key = `cashflowDailyAlertSent:${workspaceId}`;
    if (localStorage.getItem(key) === today) return;
    try {
      const notification = new Notification('CashFlow Copilot has actions to review', { body: `${alerts.length} business item(s) need attention. Open the Action Center.`, tag: `cashflow-${workspaceId}-${today}` });
      notification.onclick = () => { window.focus(); notification.close(); };
      localStorage.setItem(key, today);
    } catch { /* The in-app briefing remains available if this browser blocks notifications. */ }
  }, [data, notificationEnabled, alerts.length, workspaceId, today]);

  async function enableNotifications() {
    if (!('Notification' in window)) { setMessage('This browser does not support desktop notifications.'); return; }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') { setMessage('Browser notifications were not enabled. You can still use the briefing here.'); return; }
    localStorage.setItem(`cashflowDailyAlert:${workspaceId}`, '1'); setNotificationEnabled(true);
    setMessage('Daily browser alert enabled. It appears once per day when the Action Center is open.');
  }

  async function addStock(event) {
    event.preventDefault(); setInventoryBusy(true); setMessage(''); setError('');
    try {
      await json(`/workspaces/${workspaceId}/inventory`, 'POST', {
        name: inventoryForm.name, sku: inventoryForm.sku, unit: inventoryForm.unit, supplier: inventoryForm.supplier,
        quantityOnHand: Number(inventoryForm.quantityOnHand), reorderPoint: Number(inventoryForm.reorderPoint),
        reorderQuantity: Number(inventoryForm.reorderQuantity), leadTimeDays: Number(inventoryForm.leadTimeDays),
        unitCostPaise: Math.round(Number(inventoryForm.unitCostRupees) * 100),
      });
      setInventoryForm(emptyInventory); setMessage('Stock item saved. Reorder warnings will use this item’s threshold.'); await refresh();
    } catch (cause) { setError(cause.message); }
    finally { setInventoryBusy(false); }
  }

  async function updateStock(item, quantity) {
    setBusyItem(item.id); setError(''); setMessage('');
    try { await json(`/workspaces/${workspaceId}/inventory/${item.id}`, 'PATCH', { quantityOnHand: Number(quantity) }); setMessage(`${item.name} stock level updated.`); await refresh(); }
    catch (cause) { setError(cause.message); }
    finally { setBusyItem(''); }
  }

  async function removeStock(item) {
    setBusyItem(item.id); setError(''); setMessage('');
    try { await api(`/workspaces/${workspaceId}/inventory/${item.id}`, { method: 'DELETE' }); setMessage(`${item.name} removed from stock watch.`); await refresh(); }
    catch (cause) { setError(cause.message); }
    finally { setBusyItem(''); }
  }

  async function savePaymentDecision(event, item) {
    event.preventDefault();
    const draft = paymentDrafts[item.id] || { status: item.paymentReview?.status || '', note: item.paymentReview?.note || '' };
    if (!draft.status) { setError('Choose a supplier payment decision first.'); return; }
    setPaymentBusy(item.id); setError(''); setMessage('');
    try {
      await json(`/workspaces/${workspaceId}/items/${item.id}/payment-review`, 'PATCH', draft);
      setMessage(`Owner decision saved for ${item.externalId || item.counterparty}. The bill remains due until recorded as paid.`);
      await refresh();
    } catch (cause) { setError(cause.message); }
    finally { setPaymentBusy(''); }
  }

  if (!workspaceId) return <section><h1>Action Center</h1><p>Select a business to see its proactive actions.</p></section>;
  const reserveText = cashWarning ? `${negativeComesFirst ? 'Cash may turn negative' : 'Cash may fall below reserve'} on ${cashWarning}.` : 'Current forecast shows no reserve breach.';
  return <section className="action-center">
    <header className="action-center-header"><div><p className="eyebrow">OWNER BRIEFING · {today}</p><h1>Action Center</h1>
      <p>Today’s next steps, assembled from your cash forecast, invoices, bank activity, Tally sync, saved order plans, and stock levels.</p></div>
      <div className="page-actions"><button type="button" className="secondary" onClick={() => refresh().catch(cause => setError(cause.message))}>Refresh actions</button>
        <button type="button" onClick={() => navigator.clipboard?.writeText?.(digest)?.then(() => setMessage('Daily briefing copied.')).catch(() => setError('Could not copy the briefing.'))}>Copy daily briefing</button></div>
    </header>
    <div className="action-briefing card"><div><h2>{alerts.length ? `${alerts.length} action group${alerts.length === 1 ? '' : 's'} need attention` : 'You’re up to date'}</h2>
      <p>{reserveText} Business data snapshot: {snapshot}{data?.workspace?.asOfDate && snapshot !== today ? ` · today is ${today}` : ''}.</p>
      <p className="muted">Signals refresh while this page is open. Date-based alerts use the workspace snapshot. Inventory reorder alerts use the thresholds you enter.</p></div>
      <button className="secondary" type="button" onClick={enableNotifications}>{notificationEnabled ? 'Browser daily alert is on' : 'Turn on daily browser alert'}</button></div>

    {!data && <div className="card" role="status">Loading this business’s action signals…</div>}
    {data && <div className="action-card-grid">
      <ActionCard title="Cash outlook" count={cashWarning ? 1 : 0} tone={cashWarning ? 'urgent' : 'normal'} action="Open Cash Outlook" onAction={() => onNavigate('outlook')}>
        <p>{reserveText}{risk?.worstDate ? ` Lowest forecast cash is ${money(risk.worstCashPaise)} on ${risk.worstDate}.` : ''}</p>
      </ActionCard>
      <ActionCard title="Customer collections" count={dueCollections.length + promiseIssues.length} tone={dueCollections.length ? 'warning' : 'normal'} action="Open collection follow-ups" onAction={() => onNavigate('operations')}>
        {dueCollections.length ? <ul>{dueCollections.slice(0, 4).map(item => <li key={item.id}>{item.counterparty} · {item.externalId || 'Invoice'} · {money(Math.max(0, item.amountPaise - item.settledPaise))} · expected {item.expectedDate}</li>)}</ul>
          : <p>No open customer invoice is due within seven days of this snapshot.</p>}
        {promiseIssues.length > 0 && <p>{promiseIssues.length} payment promise(s) are broken or need settlement review. Open Cash Outlook to revise the dates.</p>}
      </ActionCard>
      <ActionCard title="Supplier payments" count={duePayables.length} tone={duePayables.length ? 'warning' : 'normal'} action="Plan payments" onAction={() => onNavigate('rescue')}>
        {duePayables.length ? duePayables.slice(0, 4).map(item => {
          const draft = paymentDrafts[item.id] || { status: item.paymentReview?.status || '', note: item.paymentReview?.note || '' };
          const reviewLabel = item.paymentReviewStale ? 'Previous decision is outdated because the bill changed'
            : item.paymentReview?.status?.replaceAll('_', ' ') || 'No owner decision recorded';
          return <div className="payable-review-row" key={item.id}><p><strong>{item.counterparty}</strong> · {item.externalId || 'Bill'} · {money(Math.max(0, item.amountPaise - item.settledPaise))} · due {item.dueDate || item.expectedDate}</p>
            <p className="decision-muted">Decision: {reviewLabel}</p>
            {businessRole === 'owner' && <form className="payable-review-form" onSubmit={event => savePaymentDecision(event, item)}>
              <label>Owner decision<select required value={draft.status} onChange={event => setPaymentDrafts(current => ({ ...current, [item.id]: { ...draft, status: event.target.value } }))}>
                <option value="">Choose…</option><option value="approved_to_schedule">Approve to schedule</option><option value="deferred">Defer</option><option value="needs_discussion">Needs discussion</option>
              </select></label>
              <label>Note (optional)<input maxLength="500" value={draft.note} onChange={event => setPaymentDrafts(current => ({ ...current, [item.id]: { ...draft, note: event.target.value } }))} /></label>
              <button type="submit" className="secondary" disabled={paymentBusy === item.id}>{paymentBusy === item.id ? 'Saving…' : 'Save decision'}</button>
            </form>}
          </div>;
        })
          : <p>No supplier bill is due within seven days of this snapshot.</p>}
        <p className="muted">Approval records the owner’s decision to schedule a payment. It does not release funds, change the due date, or mark the bill paid.</p>
      </ActionCard>
      <ActionCard title="Invoice capture & bank matching" count={needsReview.length + unresolvedBank.length + (ledgerStale ? 1 : 0)} tone={needsReview.length || unresolvedBank.length || ledgerStale ? 'warning' : 'normal'} action="Review imports and bank rows" onAction={() => onNavigate('setup')}>
        <p>{needsReview.length} ledger record(s) need verification; {unresolvedBank.length} recent bank transaction(s) remain unmatched or partly unmatched.</p>
        {ledgerStale && <p className="issue">Cash records have not changed for {data.forecast.dataFreshness.staleDays} days. Confirm recent bank and invoice activity was imported.</p>}
        <p className="muted">Tally sync: {syncSummary}{data.sync?.actionableError ? ` · ${data.sync.actionableError.message}` : ''}{data.syncChanges.length ? ` · ${data.syncChanges.length} change(s) awaiting approval` : ''}{syncStale ? ' · last successful sync is more than 2 days old' : ''}.</p>
      </ActionCard>
      <ActionCard title="Order follow-through" count={staleScenarios.length + orderFollowups.length} tone={staleScenarios.length || orderFollowups.length ? 'warning' : 'normal'} action="Review saved order analyses" onAction={() => onNavigate('orders')}>
        {orderFollowups.length > 0 && <p>{orderFollowups.length} accepted order(s) have reached their proposed final collection date.</p>}
        {staleScenarios.length ? <ul>{staleScenarios.slice(0, 4).map(scenario => <li key={scenario._id}>{scenario.label || 'Saved order'} · {scenario.freshness?.message || 'Cash inputs changed; recalculate before relying on this result.'}</li>)}</ul>
          : <p>{activeOrders.length ? `${activeOrders.length} order(s) are being tracked through owner-entered progress.` : 'No accepted order is being tracked yet.'}</p>}
        <p className="muted">Progress and date alerts are reminders only; actual receipts and costs still need to be recorded in the ledger.</p>
      </ActionCard>
      <ActionCard title="Stock and reorder watch" count={lowStock.length} tone={lowStock.length ? 'warning' : 'normal'}>
        {lowStock.length ? <ul>{lowStock.slice(0, 4).map(item => <li key={item.id}>{item.name}: {item.quantityOnHand} {item.unit} on hand · reorder {item.reorderQuantity} · estimate {money(item.suggestedPurchaseCostPaise)}{item.supplier ? ` from ${item.supplier}` : ''}</li>)}</ul>
          : <p>{data.inventory.length ? 'No stock item has reached its reorder point.' : 'Add a stock item and reorder threshold to start receiving alerts.'}</p>}
        {lowStock.some(item => item.suggestedPurchaseCostPaise > (data.forecast?.safeToSpendPaise ?? 0)) && <p className="issue">At least one suggested reorder costs more than the current reserve-aware safe-to-spend estimate. Review cash before ordering.</p>}
        <p className="muted">Reorder quantities and lead times are owner-entered; stock consumption is not yet inferred from production orders.</p>
      </ActionCard>
      {businessRole === 'owner' && <ActionCard title="WhatsApp message review" count={pendingCaptures.length} tone={pendingCaptures.length ? 'warning' : 'normal'} action="Review captured messages" onAction={() => document.querySelector('.whatsapp-capture-desk')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
        {pendingCaptures.length ? <ul>{pendingCaptures.slice(0, 4).map(capture => <li key={capture.id}>{capture.senderName || capture.senderPhone || 'Customer'} · {capture.captureType} · {new Date(capture.receivedAt).toLocaleDateString('en-IN')}</li>)}</ul>
          : <p>No WhatsApp message is waiting for owner review.</p>}
        <p className="muted">Approving creates an editable draft for the order analyzer or payment promises.</p>
      </ActionCard>}
      {businessRole === 'owner' && <ActionCard title="Supplier procurement" count={procurementNeedsReview.length + procurementDue.length} tone={procurementNeedsReview.length || procurementDue.length ? 'warning' : 'normal'} action="Review supplier purchases" onAction={() => document.querySelector('.procurement-desk')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
        {procurementNeedsReview.length ? <ul>{procurementNeedsReview.slice(0, 4).map(request => <li key={request.id}>{request.name} · {request.supplier} · {request.status.replaceAll('_', ' ')}</li>)}</ul>
          : <p>No supplier quote or cash approval is waiting.</p>}
        {procurementDue.length > 0 && <p>{procurementDue.length} supplier payment commitment date(s) fall within the next seven days.</p>}
        <p className="muted">Check quoted terms and cash impact before approving a purchase commitment.</p>
      </ActionCard>}
      {businessRole === 'owner' && <ActionCard title="Delivery and collection" count={deliveryDue.length + collectionDue.length} tone={deliveryDue.length || collectionDue.length ? 'warning' : 'normal'} action="Open delivery board" onAction={() => document.querySelector('.fulfillment-desk')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
        {deliveryDue.length ? <p>{deliveryDue.length} order(s) reached their expected delivery date. Confirm progress or dispatch with proof.</p>
          : <p>{fulfillmentInProgress.length} order(s) are being tracked through production.</p>}
        {collectionDue.length > 0 && <p>{collectionDue.length} delivered invoice(s) reach their collection date within seven days.</p>}
        <p className="muted">Dispatch creates one final-balance receivable. Collection reminders require a separate owner action.</p>
      </ActionCard>}
    </div>}

    {data && <section className="card stock-watch"><h2>Stock watchlist</h2>
      {data.inventory.map(item => <StockRow key={item.id} item={item} busy={busyItem === item.id} onSave={value => updateStock(item, value)} onRemove={() => removeStock(item)} canEdit={businessRole === 'owner'} />)}
      {businessRole === 'owner' ? <form className="form-grid" onSubmit={addStock}>
        <label>Item name<input required maxLength="160" value={inventoryForm.name} onChange={event => setInventoryForm({ ...inventoryForm, name: event.target.value })} /></label>
        <label>SKU (optional)<input maxLength="80" value={inventoryForm.sku} onChange={event => setInventoryForm({ ...inventoryForm, sku: event.target.value })} /></label>
        <label>Supplier (optional)<input maxLength="160" value={inventoryForm.supplier} onChange={event => setInventoryForm({ ...inventoryForm, supplier: event.target.value })} /></label>
        <label>Unit<input required maxLength="24" value={inventoryForm.unit} onChange={event => setInventoryForm({ ...inventoryForm, unit: event.target.value })} /></label>
        <label>On hand<input required type="number" min="0" step="1" value={inventoryForm.quantityOnHand} onChange={event => setInventoryForm({ ...inventoryForm, quantityOnHand: event.target.value })} /></label>
        <label>Reorder at<input required type="number" min="0" step="1" value={inventoryForm.reorderPoint} onChange={event => setInventoryForm({ ...inventoryForm, reorderPoint: event.target.value })} /></label>
        <label>Order quantity<input required type="number" min="1" step="1" value={inventoryForm.reorderQuantity} onChange={event => setInventoryForm({ ...inventoryForm, reorderQuantity: event.target.value })} /></label>
        <label>Supplier lead time (days)<input required type="number" min="0" max="365" step="1" value={inventoryForm.leadTimeDays} onChange={event => setInventoryForm({ ...inventoryForm, leadTimeDays: event.target.value })} /></label>
        <label>Unit cost (INR)<input required type="number" min="0" step="0.01" value={inventoryForm.unitCostRupees} onChange={event => setInventoryForm({ ...inventoryForm, unitCostRupees: event.target.value })} /></label>
        <button disabled={inventoryBusy}>{inventoryBusy ? 'Saving…' : 'Add stock item'}</button>
      </form> : <p>Only the business owner can edit stock watch thresholds.</p>}
    </section>}
    {data && businessRole === 'owner' && <ProactiveCollections workspaceId={workspaceId} token="" enabled />}
    {data && <WhatsAppCaptureDesk workspaceId={workspaceId} businessRole={businessRole} refreshKey={workflowRefreshKey} onApproved={onCaptureApproved} />}
    {data && <ProcurementDesk workspaceId={workspaceId} businessRole={businessRole} refreshKey={workflowRefreshKey} />}
    {data && <FulfillmentDesk workspaceId={workspaceId} businessRole={businessRole} refreshKey={workflowRefreshKey} />}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}

function StockRow({ item, busy, onSave, onRemove, canEdit }) {
  const [quantity, setQuantity] = useState(String(item.quantityOnHand));
  const validQuantity = /^\d+$/.test(quantity) && Number.isSafeInteger(Number(quantity));
  useEffect(() => setQuantity(String(item.quantityOnHand)), [item.quantityOnHand]);
  return <article className={`stock-row${item.atReorderPoint ? ' is-low' : ''}`}>
    <div><strong>{item.name}</strong>{item.sku && <span> · {item.sku}</span>}<p>{item.quantityOnHand} {item.unit} on hand · reorder at {item.reorderPoint} · lead time {item.leadTimeDays} days · estimated order {money(item.suggestedPurchaseCostPaise)}</p></div>
    {canEdit && <div className="stock-row-actions"><label>Update quantity<input type="number" min="0" step="1" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
      <button type="button" className="secondary" disabled={busy || !validQuantity} onClick={() => onSave(quantity)}>Save count</button>
      <button type="button" className="secondary" disabled={busy} onClick={onRemove}>Remove</button></div>}
  </article>;
}
