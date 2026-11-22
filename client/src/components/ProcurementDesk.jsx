import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';

const money = paise => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format((paise || 0) / 100);
const indiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plusDay = value => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
const statusLabel = status => ({ draft: 'Quote requested', quote_received: 'Quote received', approved: 'Approved to plan', ordered: 'Order placed', received: 'Stock received', cancelled: 'Cancelled' }[status] || status);

export default function ProcurementDesk({ workspaceId, businessRole = 'owner', refreshKey = 0 }) {
  const [inventory, setInventory] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ inventoryItemId: '', quantity: '', supplier: '', supplierPhone: '', orderDate: indiaToday(), paymentTermsDays: '0' });
  const [workspace, setWorkspace] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  async function refresh() {
    if (!workspaceId) return;
    const [stock, queue, business] = await Promise.all([
      api(`/workspaces/${workspaceId}/inventory`),
      api(`/workspaces/${workspaceId}/procurement`),
      api(`/workspaces/${workspaceId}`),
    ]);
    setInventory(stock.items || []);
    setRequests(queue.requests || []);
    setWorkspace(business.workspace);
    if (business.workspace?.asOfDate) {
      const nextDay = plusDay(business.workspace.asOfDate);
      const today = indiaToday();
      const minimumOrderDate = today > nextDay ? today : nextDay;
      setForm(current => ({ ...current, orderDate: current.orderDate > business.workspace.asOfDate ? current.orderDate : minimumOrderDate }));
    }
  }

  useEffect(() => {
    setInventory([]); setRequests([]); setWorkspace(null); setError(''); setMessage('');
    refresh().catch(cause => setError(cause.message));
  }, [workspaceId]);
  useEffect(() => { if (refreshKey) refresh().catch(cause => setError(cause.message)); }, [refreshKey]);

  const selectedItem = inventory.find(item => item.id === form.inventoryItemId);
  async function createDraft(event) {
    event.preventDefault(); setBusy('create'); setError(''); setMessage('');
    try {
      const result = await json(`/workspaces/${workspaceId}/procurement`, 'POST', {
        inventoryItemId: form.inventoryItemId, quantity: Number(form.quantity), supplier: form.supplier || selectedItem?.supplier,
        supplierPhone: form.supplierPhone, orderDate: form.orderDate, paymentTermsDays: Number(form.paymentTermsDays),
      });
      setMessage(result.message || 'Quote request draft created.');
      setForm(current => ({ inventoryItemId: '', quantity: '', supplier: '', supplierPhone: '', orderDate: current.orderDate, paymentTermsDays: '0' }));
      await refresh();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(''); }
  }

  if (!workspaceId) return null;
  if (businessRole !== 'owner') return <section className="card"><h2>Supplier procurement</h2><p>Only the business owner can create requests, approve supplier terms, and receive stock.</p></section>;

  return <section className="card procurement-desk">
    <h2>Procurement linked to stock and cash</h2>
    <p>Create a supplier quote draft from a stock item. Enter the quote and terms, simulate its payment date against the cash reserve, then approve it as a planning commitment. Nothing is sent and no payment is made automatically.</p>
    <form className="form-grid" onSubmit={createDraft}>
      <label>Stock item<select required value={form.inventoryItemId} onChange={event => {
        const item = inventory.find(row => row.id === event.target.value);
        setForm(current => ({ ...current, inventoryItemId: event.target.value,
          quantity: item?.atReorderPoint ? String(item.reorderQuantity) : current.quantity,
          supplier: item?.supplier || '' }));
      }}><option value="">Choose an item</option>{inventory.map(item => <option key={item.id} value={item.id}>{item.name} - {item.quantityOnHand} {item.unit} on hand{item.atReorderPoint ? ' - reorder point reached' : ''}</option>)}</select></label>
      <label>Quantity to request<input type="number" required min="1" step="1" value={form.quantity} onChange={event => setForm({ ...form, quantity: event.target.value })} /></label>
      <label>Supplier<input required maxLength="160" value={form.supplier} onChange={event => setForm({ ...form, supplier: event.target.value })} /></label>
      <label>Supplier WhatsApp (optional)<input type="tel" maxLength="16" value={form.supplierPhone} onChange={event => setForm({ ...form, supplierPhone: event.target.value })} placeholder="919876543210" /></label>
      <label>Proposed order date<input required type="date" min={workspace?.asOfDate ? plusDay(workspace.asOfDate) : undefined} value={form.orderDate} onChange={event => setForm({ ...form, orderDate: event.target.value })} /></label>
      <label>Estimated payment terms (days after delivery)<input required type="number" min="0" max="365" step="1" value={form.paymentTermsDays} onChange={event => setForm({ ...form, paymentTermsDays: event.target.value })} /></label>
      {selectedItem && <p className="decision-muted">Current stock: {selectedItem.quantityOnHand} {selectedItem.unit}. Estimated quantity cost: {money(Number(form.quantity || 0) * selectedItem.unitCostPaise)}. Delivery estimate: {selectedItem.leadTimeDays} day(s).</p>}
      <button disabled={busy === 'create' || !inventory.length}>{busy === 'create' ? 'Creating...' : 'Create quote request draft'}</button>
    </form>

    {requests.length === 0 && <p>No procurement requests yet. Add a stock item in the Action Center, then request a supplier quote here.</p>}
    {requests.map(request => <ProcurementCard key={request.id} request={request} workspaceId={workspaceId} onChanged={async text => { setMessage(text); await refresh(); }} onError={setError} />)}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}

function ProcurementCard({ request, workspaceId, onChanged, onError }) {
  const [quote, setQuote] = useState({ amount: String((request.quoteAmountPaise ?? request.estimatedAmountPaise) / 100),
    leadTimeDays: String(request.leadTimeDays), paymentTermsDays: String(request.paymentTermsDays), orderDate: request.orderDate,
    supplier: request.supplier, supplierPhone: request.supplierPhone || '' });
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState('');
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);
  const [cancelNote, setCancelNote] = useState('');

  useEffect(() => setQuote({ amount: String((request.quoteAmountPaise ?? request.estimatedAmountPaise) / 100),
    leadTimeDays: String(request.leadTimeDays), paymentTermsDays: String(request.paymentTermsDays), orderDate: request.orderDate,
    supplier: request.supplier, supplierPhone: request.supplierPhone || '' }), [request.id, request.quoteAmountPaise, request.estimatedAmountPaise,
    request.leadTimeDays, request.paymentTermsDays, request.orderDate, request.supplier, request.supplierPhone]);

  const apiCall = async (path, method, body) => {
    setBusy(path); onError('');
    try { return await json(`/workspaces/${workspaceId}/procurement/${request.id}${path}`, method, body); }
    finally { setBusy(''); }
  };
  const quoteMessage = `Hello ${request.supplier}. Please share your best quote for ${request.quantity} ${request.unit} of ${request.name}${request.sku ? ` (SKU ${request.sku})` : ''}. Requested delivery: ${request.expectedDeliveryDate}. Please include price, delivery lead time, and payment terms.`;
  const phone = String(request.supplierPhone || '').replace(/\D/g, '');
  const risk = analysis || request.lastAnalysis;

  async function submitQuote(event) {
    event.preventDefault();
    try {
      await apiCall('/quote', 'PATCH', { quoteAmountPaise: Math.round(Number(quote.amount) * 100), leadTimeDays: Number(quote.leadTimeDays),
        paymentTermsDays: Number(quote.paymentTermsDays), orderDate: quote.orderDate, supplier: quote.supplier, supplierPhone: quote.supplierPhone });
      await onChanged('Supplier quote saved. Analyze its payment date before approving.');
    } catch (cause) { onError(cause.message); }
  }
  async function analyze() {
    try { const result = await apiCall('/analyze', 'POST', {}); setAnalysis(result.analysis); await onChanged('Cash impact recalculated with approved purchase commitments included.'); }
    catch (cause) { onError(cause.message); }
  }
  async function changeStatus(status) {
    try {
      const result = await apiCall('/status', 'PATCH', { status, cashRiskAcknowledged: acknowledgeRisk, note: cancelNote });
      setAnalysis(result.analysis || analysis);
      await onChanged(result.message || `Procurement moved to ${statusLabel(status)}.`);
    } catch (cause) { onError(cause.message); }
  }
  async function copyQuoteText() {
    try { await navigator.clipboard.writeText(quoteMessage); await onChanged('Quote request text copied. Review it before sending.'); }
    catch { onError('Clipboard access is unavailable. Select and copy the quote request text below.'); }
  }
  async function receive() {
    const key = `cashflowProcurementReceipt:${workspaceId}:${request.id}`;
    let requestId = localStorage.getItem(key);
    if (!requestId) { requestId = crypto.randomUUID(); localStorage.setItem(key, requestId); }
    try {
      const result = await apiCall('/receive', 'POST', { requestId });
      await onChanged(result.message);
    } catch (cause) { onError(cause.message); }
  }

  return <article className="procurement-request decision-notice">
    <div className="action-card-head"><h3>{request.name} - {request.quantity} {request.unit}</h3><span className="decision-badge">{statusLabel(request.status)}</span></div>
    <p>{request.supplier} - Estimated {money(request.estimatedAmountPaise)}{request.quoteAmountPaise ? ` - Quote ${money(request.quoteAmountPaise)}` : ''}</p>
    <p>Expected delivery {request.expectedDeliveryDate} - supplier payment due {request.paymentDueDate} - terms {request.paymentTermsDays} days.</p>
    {request.status === 'draft' && <><p>Quote request draft. It will not be sent automatically.</p>
      <label>WhatsApp quote request text<textarea readOnly rows="4" value={quoteMessage} /></label>
      <button type="button" className="secondary" onClick={copyQuoteText}>Copy quote text</button>
      {phone && <p><a href={`https://wa.me/${phone}?text=${encodeURIComponent(quoteMessage)}`} target="_blank" rel="noopener noreferrer">Review quote request in WhatsApp</a></p>}
      <form className="form-grid procurement-quote-form" onSubmit={submitQuote}>
        <label>Quoted total (INR)<input required type="number" min="0.01" step="0.01" value={quote.amount} onChange={event => setQuote({ ...quote, amount: event.target.value })} /></label>
        <label>Lead time (days)<input required type="number" min="0" max="365" value={quote.leadTimeDays} onChange={event => setQuote({ ...quote, leadTimeDays: event.target.value })} /></label>
        <label>Payment terms (days after delivery)<input required type="number" min="0" max="365" value={quote.paymentTermsDays} onChange={event => setQuote({ ...quote, paymentTermsDays: event.target.value })} /></label>
        <label>Order date<input required type="date" value={quote.orderDate} onChange={event => setQuote({ ...quote, orderDate: event.target.value })} /></label>
        <label>Supplier name<input required maxLength="160" value={quote.supplier} onChange={event => setQuote({ ...quote, supplier: event.target.value })} /></label>
        <label>Supplier WhatsApp<input type="tel" maxLength="16" value={quote.supplierPhone} onChange={event => setQuote({ ...quote, supplierPhone: event.target.value })} /></label>
        <button type="submit" disabled={Boolean(busy)}>{busy ? 'Saving...' : 'Record supplier quote'}</button>
      </form></>}
    {(request.status === 'draft' || request.status === 'quote_received') && <button type="button" className="secondary" disabled={Boolean(busy)} onClick={analyze}>{busy === '/analyze' ? 'Checking forecast...' : 'Analyze purchase cash impact'}</button>}
    {risk && <div className="procurement-analysis">
      <p>Cash before purchase: low point {money(risk.baselineWorstCashPaise ?? risk.baseline?.worstCashPaise)}{(risk.baselineFirstReserveBreachDate || risk.baseline?.firstReserveBreachDate) ? ` - reserve first breached ${(risk.baselineFirstReserveBreachDate || risk.baseline.firstReserveBreachDate)}` : ''}.</p>
      <p>Cash with purchase: low point {money(risk.purchaseWorstCashPaise ?? risk.withPurchase?.worstCashPaise)}{(risk.purchaseFirstReserveBreachDate || risk.withPurchase?.firstReserveBreachDate) ? ` - reserve first breached ${(risk.purchaseFirstReserveBreachDate || risk.withPurchase.firstReserveBreachDate)}` : ''}.</p>
      {analysis?.cashImpactPaise != null && <p>Lowest projected cash reduced by {money(analysis.cashImpactPaise)}. Payment is modeled on {analysis.paymentDueDate}.</p>}
      {analysis?.warnings?.map(warning => <p key={warning} role="status">{warning}</p>)}
      {!risk.safeToSchedule && <label className="check"><input type="checkbox" checked={acknowledgeRisk} onChange={event => setAcknowledgeRisk(event.target.checked)} />I reviewed the reserve risk and still want to approve this planning commitment.</label>}
      <p className="decision-muted">Approval records an owner-approved cash planning commitment. It does not send a purchase order, pay the supplier, or post a bill.</p>
    </div>}
    {request.status === 'quote_received' && <button type="button" disabled={Boolean(busy)} onClick={() => changeStatus('approved')}>Approve planning commitment</button>}
    {request.status === 'approved' && <button type="button" disabled={Boolean(busy)} onClick={() => changeStatus('ordered')}>Mark purchase order sent</button>}
    {request.status === 'ordered' && <button type="button" disabled={Boolean(busy)} onClick={receive}>Receive goods and update stock</button>}
    {request.status === 'received' && <p role="status">{request.receiptAppliedAt ? 'Stock count updated.' : 'Stock update is being recovered; retry the receipt if it remains pending.'} Supplier payment is still separate.</p>}
    {request.planningCommitmentId && <p className="decision-muted">Planning commitment {request.planningCommitmentId} - payment outflow modeled for {request.paymentDueDate}.</p>}
    {!['received', 'cancelled'].includes(request.status) && <div className="procurement-cancel"><label>Cancellation note<input maxLength="500" value={cancelNote} onChange={event => setCancelNote(event.target.value)} /></label><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => changeStatus('cancelled')}>Cancel request</button></div>}
    {request.transitions?.length > 0 && <details><summary>Procurement history ({request.transitions.length})</summary><ol>{request.transitions.map((entry, index) => <li key={index}>{entry.from} -&gt; {entry.to}{entry.at ? ` - ${new Date(entry.at).toLocaleString()}` : ''}{entry.note ? ` - ${entry.note}` : ''}</li>)}</ol></details>}
  </article>;
}
