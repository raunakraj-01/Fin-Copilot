import React, { useEffect, useRef, useState } from 'react';
import { api, json } from '../services/api.js';
import { locale } from '../i18n/index.js';
import { parseRupees } from '../pages/OrderAnalyzer/money.js';
const fields = ['transactionId', 'date', 'description', 'creditInr', 'debitInr'];
const labels = { transactionId: 'Bank transaction ID', date: 'Transaction date', description: 'Description', creditInr: 'Credit (₹)', debitInr: 'Debit (₹)' };
const money = p => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(p / 100);

function MatchCredit({ transaction, invoices, workspaceId, onChanged }) {
  const storageKey = `bank-match:${workspaceId}:${transaction.id}`;
  const request = useRef(null);
  if (!request.current) { try { request.current = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* storage may be unavailable */ } }
  const [invoiceId, setInvoiceId] = useState(request.current?.details.cashItemId || '');
  const [promiseId, setPromiseId] = useState(request.current?.details.promiseId || '');
  const [amount, setAmount] = useState(request.current ? String(request.current.details.amountPaise / 100) : '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const invoice = invoices.find(i => i.id === invoiceId);
  async function match(input) {
    setBusy(true); setMessage('');
    try {
      await json(`/workspaces/${workspaceId}/bank/${transaction.id}/match`, 'POST', input);
      if (request.current?.requestId === input.requestId) {
        request.current = null; try { sessionStorage.removeItem(storageKey); } catch { /* optional browser persistence */ }
      }
      setAmount(''); setMessage('Payment matched. Invoice balance and forecast updated.'); onChanged();
    } catch (error) {
      if ([400, 404].includes(error.status) || error.code === 'MATCH_REJECTED') {
        request.current = null; try { sessionStorage.removeItem(storageKey); } catch { /* optional browser persistence */ }
      }
      setMessage(error.message); onChanged();
    }
    finally { setBusy(false); }
  }
  function submit(event) {
    event.preventDefault();
    try {
      const amountPaise = parseRupees(amount);
      if (!amountPaise) throw new Error('Match amount must be positive');
      const input = { cashItemId: invoiceId, amountPaise, ...(promiseId ? { promiseId } : {}) };
      if (!request.current || JSON.stringify(request.current.details) !== JSON.stringify(input)) request.current = { details: input, requestId: crypto.randomUUID() };
      try { sessionStorage.setItem(storageKey, JSON.stringify(request.current)); } catch { /* retry key remains in memory */ }
      match({ ...input, requestId: request.current.requestId });
    } catch (error) { setMessage(error.message); }
  }
  return <div>
    {transaction.suggestions?.length > 0 && <div><h4>Suggested matches · review before confirming</h4><ul>{transaction.suggestions.map(s => {
      const i = invoices.find(i => i.id === s.cashItemId);
      return <li key={s.cashItemId}>{i?.externalId || i?.counterparty} · {s.reasons.join('; ')} <button disabled={busy} type="button" className="secondary" onClick={() => { setInvoiceId(s.cashItemId); setPromiseId(''); setAmount(String(Math.min(transaction.availablePaise, i.outstandingPaise) / 100)); }}>Use suggestion</button></li>;
    })}</ul></div>}
    {transaction.reviewState === 'open' && transaction.availablePaise > 0 && !transaction.allocations.some(a => a.status === 'pending') && <form onSubmit={submit} className="form-grid"><fieldset disabled={busy} className="form-grid">
      <legend>Approve customer payment match</legend>
      <label>Invoice for {transaction.transactionId}<select required value={invoiceId} onChange={e => { setInvoiceId(e.target.value); setPromiseId(''); }}><option value="">Select invoice</option>{invoices.filter(i => i.outstandingPaise > 0 && i.confidenceState !== 'needs_review').map(i => <option key={i.id} value={i.id}>{i.externalId || i.counterparty} · {i.counterparty} · {money(i.outstandingPaise)} outstanding</option>)}</select></label>
      <label>Amount to match (₹)<input type="text" inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label>Payment promise (optional)<select value={promiseId} onChange={e => setPromiseId(e.target.value)}><option value="">No promise allocation</option>{invoice?.promises.filter(p => !p.closedAs && p.remainingPaise > 0).map(p => <option key={p.id} value={p.id}>{money(p.remainingPaise)} by {p.promisedDate}</option>)}</select></label>
      <p>Confirm this receipt has not already been entered through Already settled, Payment promises or a payment gateway. Amounts on/before the cash snapshot must already be included in opening cash.</p>
      <button disabled={!invoiceId}>Confirm match</button>
    </fieldset></form>}
    {transaction.allocations.map(a => <p key={a.requestId}>Match {money(a.amountPaise)} · {a.status}{a.error && ` · ${a.error}`}
      {a.status === 'pending' && <button disabled={busy} type="button" onClick={() => match({ requestId: a.requestId, cashItemId: a.cashItemId, amountPaise: a.amountPaise, ...(a.promiseId ? { promiseId: a.promiseId } : {}) })}>Finish pending match</button>}</p>)}
    {message && <p role="status">{message}</p>}
  </div>;
}
function ReviewRow({ transaction, workspaceId, onChanged }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function review(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await json(`/workspaces/${workspaceId}/bank/${transaction.id}/review`, 'PATCH', { state: transaction.reviewState === 'open' ? 'excluded' : 'open', note }); setNote(''); onChanged(); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <form onSubmit={review} className="form-grid"><label>Review note for {transaction.transactionId}<input required maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Explain where this amount is already recorded" /></label>
    <button disabled={busy || transaction.allocations.some(a => a.status === 'pending')}>{transaction.reviewState === 'open' ? 'Mark unmatched amount reviewed separately' : 'Reopen for matching'}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
export default function BankReconciliation({ workspaceId, refreshKey, onChanged }) {
  const [data, setData] = useState(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState(''); const [file, setFile] = useState(null); const [batch, setBatch] = useState(null);
  const [offset, setOffset] = useState(0);
  const [mapping, setMapping] = useState({}); const [rows, setRows] = useState([]); const [corrections, setCorrections] = useState({}); const [excluded, setExcluded] = useState([]);
  async function load() { setData(await api(`/workspaces/${workspaceId}/bank?offset=${offset}`)); }
  useEffect(() => { let active = true; setData(null); api(`/workspaces/${workspaceId}/bank?offset=${offset}`).then(value => { if (active) setData(value); }).catch(e => { if (active) setMessage(e.message); }); return () => { active = false; }; }, [workspaceId, refreshKey, offset]);
  async function run(action) { setBusy(true); setMessage(''); try { await action(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } }
  const changed = () => { load().catch(e => setMessage(e.message)); onChanged?.(); };
  return <section className="card"><h2>Bank receipts & invoice matching</h2>
    <p>Import a bank statement with a stable transaction ID, YYYY-MM-DD date, description and separate credit/debit columns. Use the same account name for repeat imports. Statement imports are read-only until a customer receipt is matched; other amounts require review against your cash records.</p>
    <a href="/templates/bank-statement.csv" download>Download bank statement template</a>
    <form className="form-grid" onSubmit={e => { e.preventDefault(); run(async () => {
      const body = new FormData(); body.append('accountKey', account); body.append('file', file);
      const result = await api(`/workspaces/${workspaceId}/bank/imports/inspect`, { method: 'POST', body });
      setBatch(result); setMapping(result.suggestedMapping); setRows([]); setCorrections({}); setExcluded([]);
    }); }}>
      <label>Bank account name<input required maxLength={100} value={account} onChange={e => setAccount(e.target.value)} placeholder="e.g. Business current account" /></label>
      <label>Bank statement CSV or XLSX<input type="file" accept=".csv,.xlsx" required onChange={e => setFile(e.target.files[0])} /></label><button disabled={busy || !file}>Inspect bank statement</button>
    </form>
    {batch && <div><h3>Bank column mapping</h3><div className="form-grid">{fields.map(field => <label key={field}>{labels[field]}<select value={mapping[field] || ''} onChange={e => { setMapping({ ...mapping, [field]: e.target.value }); setRows([]); setCorrections({}); setExcluded([]); }}><option value="">Unmapped</option>{batch.headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</div>
      <button disabled={busy} onClick={() => run(async () => { const result = await json(`/workspaces/${workspaceId}/bank/imports/${batch.batchId}/validate`, 'POST', { mapping }); setRows(result.rows); })}>Validate bank rows</button>
    </div>}
    {rows.length > 0 && <div><h3>Review bank rows</h3>{rows.map(row => <details key={row.rowNumber} open={row.state !== 'accepted'}><summary>Row {row.rowNumber} · {row.item.transactionId || 'Missing ID'} · {row.state}</summary>
      {row.issues.map(issue => <p className="issue" key={issue}>{issue}</p>)}
      <label><input type="checkbox" checked={excluded.includes(row.rowNumber)} onChange={e => setExcluded(e.target.checked ? [...excluded, row.rowNumber] : excluded.filter(n => n !== row.rowNumber))} />Exclude bank row {row.rowNumber}</label>
      <div className="form-grid">{fields.map(field => <label key={field}>Row {row.rowNumber} {labels[field]}<input value={corrections[row.rowNumber]?.[field] ?? (field === 'creditInr' ? row.item.creditPaise / 100 : field === 'debitInr' ? row.item.debitPaise / 100 : row.item[field] || '')} onChange={e => setCorrections({ ...corrections, [row.rowNumber]: { ...corrections[row.rowNumber], [field]: e.target.value } })} /></label>)}</div>
    </details>)}<button disabled={busy} onClick={() => run(async () => {
      const summary = await json(`/workspaces/${workspaceId}/bank/imports/${batch.batchId}/commit`, 'POST', { corrections: Object.entries(corrections).map(([rowNumber, values]) => ({ rowNumber: Number(rowNumber), values })), excludedRowNumbers: excluded });
      setMessage(`Imported ${summary.savedCount} bank rows; skipped ${summary.skippedCount}. ${summary.duplicateConflicts.filter(c => c.changed).length} duplicate references have changed details and need review. Existing rows were preserved.`);
      setBatch(null); setRows([]); changed();
    })}>Import reviewed bank rows</button></div>}
    {message && <p role="status">{message}</p>}
    <button disabled={busy} type="button" className="secondary" onClick={() => run(load)}>Refresh bank matches</button>
    {data && <p>Cash snapshot: {data.asOfDate} · Up to {data.limit} bank rows per page. Unmatched and pending rows remain flagged in the forecast; resolve or document their treatment.</p>}
    {data && <div className="page-actions"><button type="button" className="secondary" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 500))}>Newer bank rows</button>
      <button type="button" className="secondary" disabled={busy || offset + 500 >= (data.total || 0)} onClick={() => setOffset(offset + 500)}>Older bank rows</button></div>}
    {data?.transactions?.length === 0 && <p>No bank transactions imported.</p>}
    {data?.transactions?.map(transaction => <article className="card" key={transaction.id}><h3>{transaction.transactionId} · {transaction.date}</h3>
      <p>{transaction.accountKey} · {transaction.description} · Credit {money(transaction.creditPaise)} · Debit {money(transaction.debitPaise)} · Unallocated credit {money(transaction.availablePaise)} · {transaction.reviewState}</p>
      {transaction.creditPaise > 0 && <MatchCredit transaction={transaction} invoices={data.invoices || []} workspaceId={workspaceId} onChanged={changed} />}
      {(transaction.availablePaise > 0 || transaction.debitPaise > 0 || transaction.reviewState === 'excluded') && <ReviewRow transaction={transaction} workspaceId={workspaceId} onChanged={changed} />}
      {transaction.reviewNote && <p>Review note: {transaction.reviewNote}</p>}
    </article>)}
  </section>;
}
