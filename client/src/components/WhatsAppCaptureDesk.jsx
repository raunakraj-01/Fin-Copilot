import React, { useCallback, useEffect, useState } from 'react';
import { api, json } from '../services/api.js';

const money = value => value == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100);
const statusLabel = value => ({ pending: 'Waiting for owner review', approved: 'Approved draft', rejected: 'Rejected' }[value] || value);

function proposalSummary(capture) {
  const proposal = capture.proposal || {};
  if (capture.captureType === 'order') return <dl>
    <dt>Customer</dt><dd>{proposal.customerName || 'Missing'}</dd>
    <dt>Order</dt><dd>{proposal.quantity ? `${proposal.quantity} × ` : ''}{proposal.itemName || 'Missing'}</dd>
    <dt>Value</dt><dd>{money(proposal.orderValuePaise)}</dd>
    <dt>Advance</dt><dd>{money(proposal.advancePaise)}{proposal.advanceDate ? ` · ${proposal.advanceDate}` : ''}</dd>
    <dt>Delivery / final collection</dt><dd>{proposal.deliveryDate || 'Missing'} / {proposal.finalCollectionDate || 'Missing'}</dd>
  </dl>;
  if (capture.captureType === 'promise') return <dl>
    <dt>Invoice ID</dt><dd>{proposal.invoiceId || 'Missing'}</dd>
    <dt>Promised amount</dt><dd>{money(proposal.amountPaise)}</dd>
    <dt>Promised date</dt><dd>{proposal.promisedDate || 'Missing'}</dd>
  </dl>;
  return null;
}

export default function WhatsAppCaptureDesk({ workspaceId, businessRole = 'owner', refreshKey = 0, onApproved }) {
  const [captures, setCaptures] = useState([]);
  const [busyId, setBusyId] = useState('');
  const [noteById, setNoteById] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId || businessRole !== 'owner') return;
    setLoading(true); setError('');
    try {
      const result = await api(`/workspaces/${workspaceId}/captures`);
      setCaptures(result.captures || []);
    } catch (cause) { setError(cause.message); }
    finally { setLoading(false); }
  }, [workspaceId, businessRole]);

  useEffect(() => { setCaptures([]); setMessage(''); load(); }, [load]);
  useEffect(() => { if (refreshKey) load(); }, [refreshKey]);

  async function review(capture, decision) {
    setBusyId(capture.id); setError(''); setMessage('');
    try {
      const result = await json(`/workspaces/${workspaceId}/captures/${capture.id}/review`, 'POST', {
        decision, note: noteById[capture.id] || '',
      });
      setCaptures(current => current.map(item => item.id === capture.id ? result.capture : item));
      if (decision === 'approve') {
        setMessage(result.actionable?.type === 'order_analysis_draft'
          ? 'Order draft approved. Review its terms in New Order Analyzer before quoting.'
          : 'Payment promise draft approved. Match the invoice and confirm it in Payment Promises.');
        onApproved?.(result.actionable, result.capture);
      } else setMessage('Message rejected and kept in the capture history.');
    } catch (cause) { setError(cause.message); }
    finally { setBusyId(''); }
  }

  if (businessRole !== 'owner') return <section className="card"><h2>WhatsApp capture inbox</h2><p>Only the business owner can review captured customer messages.</p></section>;
  const pendingCount = captures.filter(capture => capture.status === 'pending').length;
  return <section className="card whatsapp-capture-desk">
    <div className="page-actions"><div><h2>WhatsApp order & payment capture</h2><p>Incoming messages become drafts. Approving here does not create an order or change the cash ledger.</p></div>
      <button type="button" className="secondary" disabled={loading} onClick={load}>{loading ? 'Refreshing…' : 'Refresh inbox'}</button></div>
    <details><summary>Message formats for reliable capture</summary>
      <p>Send these structured messages through the connected WhatsApp automation:</p>
      <pre>ORDER|customer|item|quantity|delivery_date|order_value_inr|advance_inr|advance_date|final_collection_date</pre>
      <pre>PROMISE|invoice_id|amount_inr|promised_date</pre>
      <p>Dates use YYYY-MM-DD. Amounts are INR. Other text messages are saved for manual handling; this starter workflow does not capture images or voice notes.</p>
    </details>
    {pendingCount > 0 && <p className="decision-notice">{pendingCount} message(s) need a decision.</p>}
    {captures.length === 0 && !loading && <p>No messages received yet. Connect the capture endpoint to your WhatsApp or n8n inbound webhook.</p>}
    {captures.map(capture => <article className="decision-notice" key={capture.id}>
      <div className="action-card-head"><h3>{capture.captureType === 'order' ? 'Customer order request' : capture.captureType === 'promise' ? 'Payment promise' : 'Unstructured message'}</h3><span>{statusLabel(capture.status)}</span></div>
      <p>{capture.senderName || capture.senderPhone || 'Unknown sender'}{capture.senderPhone ? ` · ${capture.senderPhone}` : ''} · {new Date(capture.receivedAt).toLocaleString('en-IN')}</p>
      <blockquote>{capture.rawText}</blockquote>
      {proposalSummary(capture)}
      {capture.parseIssues?.map(issue => <p className="issue" key={issue}>{issue}</p>)}
      {capture.status === 'pending' && <>
        <label>Review note<input maxLength="500" value={noteById[capture.id] || ''} onChange={event => setNoteById(current => ({ ...current, [capture.id]: event.target.value }))} /></label>
        <div className="page-actions">
          <button type="button" disabled={busyId === capture.id || capture.parseStatus !== 'ready'} onClick={() => review(capture, 'approve')}>Approve structured draft</button>
          <button type="button" className="secondary" disabled={busyId === capture.id} onClick={() => review(capture, 'reject')}>Reject</button>
        </div>
      </>}
      {capture.actionResult?.type && <p>Approved action: {capture.actionResult.type.replaceAll('_', ' ')} · {capture.actionResult.instruction}</p>}
      {capture.reviewNote && <p className="decision-muted">Owner note: {capture.reviewNote}</p>}
    </article>)}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
