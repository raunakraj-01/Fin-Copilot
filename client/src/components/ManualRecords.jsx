import { t, useLanguage, locale } from '../i18n/index.js';
import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(value / 100);
const initialItem = {
  category: 'receivable', externalId: '', counterparty: '', amountInr: '', settledInr: '0',
  status: 'open', dueDate: '', expectedDate: '', mandatory: false, negotiable: false,
  discretionary: false, maxExtensionDays: '0', earliestCollectionDate: '',
  maxEarlyCollectionInr: '', estimatedActionCostInr: '', actionCostDate: '',
};
const toPaise = value => Math.round(Number(value) * 100);

export default function ManualRecords({ workspaceId, refreshKey }) {
  useLanguage();
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
      actionCostDate: constraints.actionCostDate || '',
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
        earliestCollectionDate: itemForm.earliestCollectionDate || null,
        actionCostDate: itemForm.actionCostDate || null,
        maxEarlyCollectionPaise: itemForm.maxEarlyCollectionInr ? toPaise(itemForm.maxEarlyCollectionInr) : null,
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
      <h2>{t("Manual cash items")}</h2>
      <p>{t("Add an item or select one below to correct its dates, settlement, or planning constraints.")}</p>
      <p>{t("When recording a real payment, also update the active workspace's opening bank cash snapshot; settled amounts are excluded from future cash movements.")}</p>
      <form onSubmit={saveItem} className="form-grid">
        <label>{t("Category")}<select value={itemForm.category} onChange={event => setItemForm({ ...itemForm, category: event.target.value })}>
          <option value="receivable">{t("Receivable")}</option><option value="payable">{t("Payable")}</option><option value="expense">{t("Expense")}</option>
        </select></label>
        <label>{t("Source ID")}<input value={itemForm.externalId} onChange={event => setItemForm({ ...itemForm, externalId: event.target.value })} /></label>
        <label>{t("Counterparty")}<input required value={itemForm.counterparty} onChange={event => setItemForm({ ...itemForm, counterparty: event.target.value })} /></label>
        <label>{t("Amount (₹)")}<input type="number" min="0.01" step="0.01" required value={itemForm.amountInr} onChange={event => setItemForm({ ...itemForm, amountInr: event.target.value })} /></label>
        <label>{t("Already settled (₹)")}<input type="number" min="0" step="0.01" required value={itemForm.settledInr} onChange={event => setItemForm({ ...itemForm, settledInr: event.target.value })} /></label>
        <label>{t("Status")}<select value={itemForm.status} onChange={event => setItemForm({ ...itemForm, status: event.target.value })}>
          <option value="open">{t("Open")}</option><option value="partial">{t("Partial")}</option><option value="paid">{t("Paid")}</option><option value="cancelled">{t("Cancelled")}</option>
        </select></label>
        <label>{t("Due date")}<input type="date" required value={itemForm.dueDate} onChange={event => setItemForm({ ...itemForm, dueDate: event.target.value })} /></label>
        <label>{t("Expected cash date")}<input type="date" value={itemForm.expectedDate} onChange={event => setItemForm({ ...itemForm, expectedDate: event.target.value })} /></label>
        <label>{t("Max extension days")}<input type="number" min="0" max="90" value={itemForm.maxExtensionDays} onChange={event => setItemForm({ ...itemForm, maxExtensionDays: event.target.value })} /></label>
        <label>{t("Earliest collection date")}<input type="date" value={itemForm.earliestCollectionDate} onChange={event => setItemForm({ ...itemForm, earliestCollectionDate: event.target.value })} /></label>
        <label>{t("Max early collection (₹)")}<input type="number" min="0" step="0.01" value={itemForm.maxEarlyCollectionInr} onChange={event => setItemForm({ ...itemForm, maxEarlyCollectionInr: event.target.value })} /></label>
        <label>{t("Estimated action cost (₹)")}<input type="number" min="0" step="0.01" value={itemForm.estimatedActionCostInr} onChange={event => setItemForm({ ...itemForm, estimatedActionCostInr: event.target.value })} /></label>
        <label>{t("Fee payment date (optional)")}<input type="date" value={itemForm.actionCostDate} onChange={event => setItemForm({ ...itemForm, actionCostDate: event.target.value })} /><small>{t("Blank means the proposed action date. Known fees reduce forecast cash.")}</small></label>
        {['mandatory', 'negotiable', 'discretionary'].map(field => <label className="check" key={field}><input type="checkbox" checked={itemForm[field]} onChange={event => setItemForm({ ...itemForm, [field]: event.target.checked })} /> {t(field)}</label>)}
        <button>{t(editingId ? 'Save correction' : 'Add cash item')}</button>
        {editingId && <button type="button" onClick={() => { setEditingId(''); setItemForm(initialItem); }}>{t("Cancel edit")}</button>}
      </form>
      <ul>{items.map(item => <li key={item.id}>{item.externalId || item.counterparty} · {t(item.category)} · {t(money(item.outstandingPaise))}{t(" outstanding · ")}{item.expectedDate || 'date needs review'} <button type="button" onClick={() => edit(item)}>{t("Edit")}</button></li>)}</ul>
    </div>
    <div className="card">
      <h2>{t("Monthly expenses")}</h2>
      <form onSubmit={saveRule} className="form-grid">
        <label>{t("Description")}<input required value={ruleForm.description} onChange={event => setRuleForm({ ...ruleForm, description: event.target.value })} /></label>
        <label>{t("Amount (₹)")}<input type="number" min="0.01" step="0.01" required value={ruleForm.amountInr} onChange={event => setRuleForm({ ...ruleForm, amountInr: event.target.value })} /></label>
        <label>{t("Day of month (1–28)")}<input type="number" min="1" max="28" required value={ruleForm.dayOfMonth} onChange={event => setRuleForm({ ...ruleForm, dayOfMonth: event.target.value })} /></label>
        <label>{t("Starts on")}<input type="date" required value={ruleForm.startsOn} onChange={event => setRuleForm({ ...ruleForm, startsOn: event.target.value })} /></label>
        <button>{t("Add monthly expense")}</button>
      </form>
      <ul>{rules.map(rule => <li key={rule._id}>{rule.description} · {t(money(rule.amountPaise))}{t(" on day ")}{t(rule.dayOfMonth)}</li>)}</ul>
    </div>
    {message && <p role="status" className="notice">{t(message)}</p>}
  </>;
}
