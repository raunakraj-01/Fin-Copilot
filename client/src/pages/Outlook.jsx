import React, { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../services/api.js';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);

export default function Outlook({ workspaceId }) {
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    api(`/workspaces/${workspaceId}/forecast`).then(value => { if (active) setForecast(value); })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [workspaceId]);

  if (!workspaceId) return <section><h1>Cash Outlook</h1><p>Create a workspace and import records first.</p></section>;
  if (error) return <section><h1>Cash Outlook</h1><p role="alert">{error}</p></section>;
  if (!forecast) return <section><h1>Cash Outlook</h1><p>Loading forecast…</p></section>;
  const { risk } = forecast;
  const events = forecast.daily.flatMap(day => day.events);
  return <section>
    <h1>Cash Outlook</h1>
    <p>This forecast assumes the entered expected payment dates. It is a scenario, not a guaranteed prediction.</p>
    <p className="notice">{risk.explanation}</p>
    <div className="metrics">
      <div className="card"><small>Opening cash</small><strong>{money(forecast.openingCashPaise)}</strong></div>
      <div className="card"><small>First negative day</small><strong>{risk.firstNegativeDate || 'None'}</strong></div>
      <div className="card"><small>First reserve breach</small><strong>{risk.firstReserveBreachDate || 'None'}</strong></div>
      <div className="card"><small>Worst balance</small><strong>{money(risk.worstCashPaise)}</strong><span>{risk.worstDate}</span></div>
    </div>
    {events.length === 0 && <p className="notice">No future cash movements are scheduled. Add or import records on Setup & Import, and check any data warnings below.</p>}
    {events.length > 0 && <div className="card"><h2>Scheduled receipts and payments</h2><div className="table-scroll"><table>
      <thead><tr><th>Date</th><th>Record</th><th>Direction</th><th>Amount</th><th>Evidence</th></tr></thead>
      <tbody>{events.map((event, index) => <tr key={`${event.id}-${index}`}>
        <td>{event.date}</td><td>{event.externalId || event.description || event.counterparty || event.id}</td>
        <td>{event.direction === 'in' ? 'Receipt' : 'Payment'}</td><td>{money(event.amountPaise)}</td>
        <td>{event.confidenceState === 'verified' ? 'Verified' : event.confidenceState === 'owner_assumption' ? 'Owner assumption' : 'Scenario'}</td>
      </tr>)}</tbody>
    </table></div></div>}
    <div className="chart" role="img" aria-label="Daily closing cash forecast">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={forecast.daily} margin={{ top: 12, right: 20, left: 15, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => value.slice(5)} minTickGap={20} />
        <YAxis tickFormatter={value => `${Math.round(value / 100000)}k`} />
        <Tooltip formatter={value => money(value)} /><Line type="monotone" dataKey="closingCashPaise" stroke="#1c4e8a" dot={false} name="Closing cash" />
      </LineChart></ResponsiveContainer>
    </div>
    {risk.contributingItems.length > 0 && <div className="card"><h2>Largest outgoing drivers</h2><ul>{risk.contributingItems.slice(0, 5).map((item, index) =>
      <li key={`${item.cashItemId}-${index}`}>{item.date} · {item.externalId || item.cashItemId} · {money(item.amountPaise)}</li>)}</ul></div>}
    {forecast.warnings.length > 0 && <div className="card"><h2>Data warnings</h2><ul>{forecast.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
  </section>;
}
