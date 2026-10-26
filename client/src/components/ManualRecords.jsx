import { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);
const initialItem = {
  category: 'receivable', externalId: '', counterparty: '', amountInr: '', settledInr: '0',
  status: 'open', dueDate: '', expectedDate: '', mandatory: false, negotiable: false,
  discretionary: false, maxExtensionDays: '0', earliestCollectionDate: '',
  maxEarlyCollectionInr: '', estimatedActionCostInr: '',
};
const toPaise = value => Math.round(Number(value) * 100);

export default function ManualRecords({ workspaceId, refreshKey }) {
  const [items, setItems] = useState([]);
  const [rules, setRules] = useState([]);
  const [itemForm, setItemForm] = useState(initialItem);
  const [editingId, setEditingId] = useState('');
  const [ruleForm, setRuleForm] = useState({ description: '', amountInr: '', dayOfMonth: '5', startsOn: '2026-11-01' });
  const [message, setMessage] = useState('');

  async function reload() {
    const [itemResult, ruleResult] = await Promise.all([
      api(`/workspaces/${workspaceId}/items`), api(`/workspaces/${workspaceId}/recurring-rules`),
    ]);
    setItems(itemResult.items); setRules(ruleResult.recurringRules);
  }

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    Promise.all([api(`/workspaces/${workspaceId}/items`), api(`/workspaces/${workspaceId}/recurring-rules`)])
      .then(([itemResult, ruleResult]) => { if (active) { setItems(itemResult.items); setRules(ruleResult.recurringRules); } })
      .catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [workspaceId, refreshKey]);

  function edit(item) {
    const constraints = item.constraints || {};
    setEditingId(item.id);
    setItemForm({ category: item.category, externalId: item.externalId || '', counterparty: item.counterparty,
      amountInr: String(item.amountPaise / 100), settledInr: String(item.settledPaise / 100), status: item.status,
      dueDate: item.dueDate, expectedDate: item.expectedDate || '', mandatory: !!constraints.mandatory,
      negotiable: !!constraints.negotiable, discretionary: !!constraints.discretionary,
      maxExtensionDays: String(constraints.maxExtensionDays || 0),
      earliestCollectionDate: constraints.earliestCollectionDate || '',
      maxEarlyCollectionInr: constraints.maxEarlyCollectionPaise == null ? '' : String(constraints.maxEarlyCollectionPaise / 100),
      estimatedActionCostInr: constraints.estimatedActionCostPaise == null ? '' : String(constraints.estimatedActionCostPaise / 100) });
  }

  async function saveItem(event) {
    event.preventDefault(); setMessage('');
    const payload = {
      category: itemForm.category, counterparty: itemForm.counterparty, amountPaise: toPaise(itemForm.amountInr),
      settledPaise: toPaise(itemForm.settledInr), status: itemForm.status, dueDate: itemForm.dueDate,
      externalId: itemForm.externalId || null, expectedDate: itemForm.expectedDate || null,
      confidenceState: itemForm.expectedDate ? 'owner_assumption' : 'needs_review',
      constraints: { mandatory: itemForm.mandatory, negotiable: itemForm.negotiable,
        discretionary: itemForm.discretionary, maxExtensionDays: Number(itemForm.maxExtensionDays),
        ...(itemForm.earliestCollectionDate && { earliestCollectionDate: itemForm.earliestCollectionDate }),
        ...(itemForm.maxEarlyCollectionInr && { maxEarlyCollectionPaise: toPaise(itemForm.maxEarlyCollectionInr) }),
        estimatedActionCostPaise: itemForm.estimatedActionCostInr ? toPaise(itemForm.estimatedActionCostInr) : null },
    };
    try {
      await json(`/workspaces/${workspaceId}/items${editingId ? `/${editingId}` : ''}`, editingId ? 'PATCH' : 'POST', payload);
      setEditingId(''); setItemForm(initialItem); await reload(); setMessage('Cash item saved.');
    } catch (error) { setMessage(error.message); }
  }

  async function saveRule(event) {
    event.preventDefault(); setMessage('');
    try {
      await json(`/workspaces/${workspaceId}/recurring-rules`, 'POST', {
        description: ruleForm.description, amountPaise: toPaise(ruleForm.amountInr),
        dayOfMonth: Number(ruleForm.dayOfMonth), startsOn: ruleForm.startsOn,
      });
      setRuleForm({ description: '', amountInr: '', dayOfMonth: '5', startsOn: ruleForm.startsOn });
      await reload(); setMessage('Monthly expense saved.');
    } catch (error) { setMessage(error.message); }
  }

  return <>
    <div className="card">
      <h2>Manual cash items</h2>
      <p>Add an item or select one below to correct its dates, settlement, or planning constraints.</p>
      <form onSubmit={saveItem} className="form-grid">
        <label>Category<select value={itemForm.category} onChange={event => setItemForm({ ...itemForm, category: event.target.value })}>
          <option value="receivable">Receivable</option><option value="payable">Payable</option><option value="expense">Expense</option>
        </select></label>
        <label>Source ID<input value={itemForm.externalId} onChange={event => setItemForm({ ...itemForm, externalId: event.target.value })} /></label>
        <label>Counterparty<input required value={itemForm.counterparty} onChange={event => setItemForm({ ...itemForm, counterparty: event.target.value })} /></label>
        <label>Amount (₹)<input type="number" min="0.01" step="0.01" required value={itemForm.amountInr} onChange={event => setItemForm({ ...itemForm, amountInr: event.target.value })} /></label>
        <label>Already settled (₹)<input type="number" min="0" step="0.01" required value={itemForm.settledInr} onChange={event => setItemForm({ ...itemForm, settledInr: event.target.value })} /></label>
        <label>Status<select value={itemForm.status} onChange={event => setItemForm({ ...itemForm, status: event.target.value })}>
          <option value="open">Open</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option>
        </select></label>
        <label>Due date<input type="date" required value={itemForm.dueDate} onChange={event => setItemForm({ ...itemForm, dueDate: event.target.value })} /></label>
        <label>Expected cash date<input type="date" value={itemForm.expectedDate} onChange={event => setItemForm({ ...itemForm, expectedDate: event.target.value })} /></label>
        <label>Max extension days<input type="number" min="0" max="90" value={itemForm.maxExtensionDays} onChange={event => setItemForm({ ...itemForm, maxExtensionDays: event.target.value })} /></label>
        <label>Earliest collection date<input type="date" value={itemForm.earliestCollectionDate} onChange={event => setItemForm({ ...itemForm, earliestCollectionDate: event.target.value })} /></label>
        <label>Max early collection (₹)<input type="number" min="0" step="0.01" value={itemForm.maxEarlyCollectionInr} onChange={event => setItemForm({ ...itemForm, maxEarlyCollectionInr: event.target.value })} /></label>
        <label>Estimated action cost (₹)<input type="number" min="0" step="0.01" value={itemForm.estimatedActionCostInr} onChange={event => setItemForm({ ...itemForm, estimatedActionCostInr: event.target.value })} /></label>
        {['mandatory', 'negotiable', 'discretionary'].map(field => <label className="check" key={field}><input type="checkbox" checked={itemForm[field]} onChange={event => setItemForm({ ...itemForm, [field]: event.target.checked })} /> {field}</label>)}
        <button>{editingId ? 'Save correction' : 'Add cash item'}</button>
        {editingId && <button type="button" onClick={() => { setEditingId(''); setItemForm(initialItem); }}>Cancel edit</button>}
      </form>
      <ul>{items.map(item => <li key={item.id}>{item.externalId || item.counterparty} · {item.category} · {money(item.outstandingPaise)} outstanding · {item.expectedDate || 'date needs review'} <button type="button" onClick={() => edit(item)}>Edit</button></li>)}</ul>
    </div>
    <div className="card">
      <h2>Monthly expenses</h2>
      <form onSubmit={saveRule} className="form-grid">
        <label>Description<input required value={ruleForm.description} onChange={event => setRuleForm({ ...ruleForm, description: event.target.value })} /></label>
        <label>Amount (₹)<input type="number" min="0.01" step="0.01" required value={ruleForm.amountInr} onChange={event => setRuleForm({ ...ruleForm, amountInr: event.target.value })} /></label>
        <label>Day of month (1–28)<input type="number" min="1" max="28" required value={ruleForm.dayOfMonth} onChange={event => setRuleForm({ ...ruleForm, dayOfMonth: event.target.value })} /></label>
        <label>Starts on<input type="date" required value={ruleForm.startsOn} onChange={event => setRuleForm({ ...ruleForm, startsOn: event.target.value })} /></label>
        <button>Add monthly expense</button>
      </form>
      <ul>{rules.map(rule => <li key={rule._id}>{rule.description} · {money(rule.amountPaise)} on day {rule.dayOfMonth}</li>)}</ul>
    </div>
    {message && <p role="status" className="notice">{message}</p>}
  </>;
}
