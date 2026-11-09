import { t, useLanguage, locale } from '../i18n/index.js';
import React, { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../services/api.js';
import PaymentPromises from '../components/PaymentPromises.jsx';
import SpendingCheck from '../components/SpendingCheck.jsx';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR' }).format(value / 100);

export default function Outlook({ workspaceId }) {
  useLanguage();
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    api(`/workspaces/${workspaceId}/forecast`).then(value => { if (active) setForecast(value); })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [workspaceId, refreshKey]);

  if (!workspaceId) return <section><h1>{t("Cash Outlook")}</h1><p>{t("Create a workspace and import records first.")}</p></section>;
  if (error) return <section><h1>{t("Cash Outlook")}</h1><p role="alert">{t(error)}</p></section>;
  if (!forecast) return <section><h1>{t("Cash Outlook")}</h1><p>{t("Loading forecast…")}</p></section>;
  const { risk } = forecast;
  const events = forecast.daily.flatMap(day => day.events);
  return <section className="cash-outlook">
    <h1>{t("Cash Outlook")}</h1>
    <p>{t("This forecast assumes the entered expected payment dates. It is a scenario, not a guaranteed prediction.")}</p>
    <p className="notice">{t(risk.explanation)}</p>
    <SpendingCheck key={`spending-${workspaceId}`} workspaceId={workspaceId} refreshKey={refreshKey} />
    <div className="metrics">
      <div className="card"><small>{t("Opening cash")}</small><strong>{t(money(forecast.openingCashPaise))}</strong></div>
      <div className="card"><small>{t("First negative day")}</small><strong>{t(risk.firstNegativeDate || 'None')}</strong></div>
      <div className="card"><small>{t("First reserve breach")}</small><strong>{t(risk.firstReserveBreachDate || 'None')}</strong></div>
      <div className={`card outlook-risk${risk.worstCashPaise < 0 ? ' outlook-risk-negative' : ''}`}><small>{t("Worst balance")}</small><strong>{t(money(risk.worstCashPaise))}</strong><span>{t(risk.worstDate)}</span></div>
    </div>
    <PaymentPromises key={workspaceId} workspaceId={workspaceId} onChanged={() => setRefreshKey(value => value + 1)} />
    {events.length === 0 && <p className="notice">{t("No future cash movements are scheduled. Add or import records on Setup & Import, and check any data warnings below.")}</p>}
    {events.length > 0 && <div className="card"><h2>{t("Scheduled receipts and payments")}</h2><div className="table-scroll"><table>
      <thead><tr><th>{t("Date")}</th><th>{t("Record")}</th><th>{t("Direction")}</th><th>{t("Amount")}</th><th>{t("Evidence")}</th></tr></thead>
      <tbody>{events.map((event, index) => <tr key={`${event.id}-${index}`}>
        <td>{t(event.date)}</td><td>{event.externalId || event.description || event.counterparty || event.id}</td>
        <td>{t(event.direction === 'in' ? 'Receipt' : 'Payment')}</td><td>{t(money(event.amountPaise))}</td>
        <td>{t(event.confidenceState === 'verified' ? 'Verified' : event.confidenceState === 'owner_assumption' ? 'Owner assumption' : 'Scenario')}</td>
      </tr>)}</tbody>
    </table></div></div>}
    <section className="chart outlook-chart">
      <div className="outlook-chart-heading"><h2>{t("Daily closing cash forecast")}</h2><span>{forecast.daily[0]?.date} – {forecast.daily.at(-1)?.date}</span></div>
      <div className="outlook-chart-plot" role="img" aria-label={t("Daily closing cash forecast")}><ResponsiveContainer width="100%" height="100%"><LineChart data={forecast.daily} margin={{ top: 12, right: 20, left: 15, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => value.slice(5)} minTickGap={20} />
        <YAxis tickFormatter={value => `${Math.round(value / 100000)}k`} />
        <ReferenceLine y={0} stroke="#a43d41" strokeDasharray="4 4" />
        <Tooltip formatter={value => money(value)} /><Line type="stepAfter" dataKey="closingCashPaise" stroke="#275e80" strokeWidth={3} dot={false} activeDot={{ r: 4 }} name={t("Closing cash")} />
      </LineChart></ResponsiveContainer></div>
    </section>
    {risk.contributingItems.length > 0 && <div className="card"><h2>{t("Largest outgoing drivers")}</h2><ul>{risk.contributingItems.slice(0, 5).map((item, index) =>
      <li key={`${item.cashItemId}-${index}`}>{t(item.date)} · {item.externalId || item.cashItemId} · {t(money(item.amountPaise))}</li>)}</ul></div>}
    {forecast.warnings.length > 0 && <div className="card"><h2>{t("Data warnings")}</h2><ul>{forecast.warnings.map((warning, index) => <li key={index}>{t(warning)}</li>)}</ul></div>}
  </section>;
}
