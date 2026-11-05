import { sessionFetch } from '../../services/session.js';
import { t, useLanguage, locale } from '../../i18n/index.js';
import React, { useEffect, useRef, useState } from 'react';
import './decision.css';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export const rupees = paise => paise == null ? '—' : new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
export const displayDate = value => value ? new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : t('None within forecast');
export const decisionApiBase = apiBaseUrl => (apiBaseUrl || import.meta.env?.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api')).replace(/\/$/, '');

export function useAnalysis(workspaceId, feature, apiBaseUrl) {
  const [state, setState] = useState({ result: null, error: '', loading: false });
  const active = useRef(null);
  const serial = useRef(0);
  function clear() {
    serial.current++;
    active.current?.abort();
    setState({ result: null, error: '', loading: false });
  }
  useEffect(() => {
    clear();
    return () => { serial.current++; active.current?.abort(); };
  }, [workspaceId, feature, apiBaseUrl]);
  async function run(body) {
    if (!workspaceId) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const request = ++serial.current;
    setState({ result: null, error: '', loading: true });
    try {
      const base = decisionApiBase(apiBaseUrl);
      const response = await sessionFetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/${feature}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Analysis failed. Please try again.');
      if (!payload.baseline || (feature === 'rescue' ? !Array.isArray(payload.plans) || !Array.isArray(payload.partialMitigations) : feature === 'shock' ? !payload.stressed || !Array.isArray(payload.priorities) : !payload.withOrder || !payload.minimumAdvance)) throw new Error('The server returned an incomplete analysis. Please retry after checking the API.');
      if (request === serial.current) setState({ result: payload, error: '', loading: false });
    } catch (error) {
      if (request === serial.current && error.name !== 'AbortError') setState({ result: null, error: error.message || 'Unable to reach the analysis service', loading: false });
    }
  }
  return { ...state, run, clear };
}

export function Metric({ label, value, note }) {
  useLanguage();
  return <div className="decision-metric"><span>{t(label)}</span><strong>{t(value)}</strong>{note && <small>{t(note)}</small>}</div>;
}
export function Notices({ warnings = [], assumptions = [] }) {
  useLanguage();
  return <>{warnings.length > 0 && <aside className="decision-notice"><strong>{t("Before using these results")}</strong><ul>{[...new Set(warnings)].map(text => <li key={text}>{t(text)}</li>)}</ul></aside>}
    {assumptions.length > 0 && <details className="decision-details"><summary>{t("Assumptions behind this analysis")}</summary><ul>{[...new Set(assumptions)].map(text => <li key={text}>{t(text)}</li>)}</ul></details>}</>;
}

export function CashChart({ series, reserve = 0, label = 'Daily cash comparison' }) {
  useLanguage();
  const available = series.filter(series => series.daily?.length);
  if (!available.length) return null;
  const byDate = available.map(series => new Map(series.daily.map(day => [day.date, day.closingCashPaise])));
  const data = available[0].daily.map(day => ({ date: day.date, ...Object.fromEntries(byDate.map((values, index) => [`series${index}`, values.get(day.date)])) }));
  return <figure className="decision-chart" aria-label={label}>
    <ResponsiveContainer width="100%" height={270} minWidth={0}>
      <LineChart data={data} margin={{ top: 16, right: 24, bottom: 12, left: 8 }} accessibilityLayer>
        <CartesianGrid stroke="#e1e5e7" strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={value => value.slice(5)} minTickGap={50} />
        <YAxis width={110} tickFormatter={rupees} domain={[minimum => Math.min(0, reserve, minimum), maximum => Math.max(reserve, maximum)]} />
        <Tooltip labelFormatter={displayDate} formatter={value => rupees(value)} />
        <ReferenceLine y={reserve} stroke="#93691f" strokeDasharray="5 4" />
        {available.map((series, index) => <Line key={series.label} type="stepAfter" dataKey={`series${index}`} name={series.label} stroke={series.color} strokeWidth={2.2} dot={false} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer>
    <figcaption>{available.map(series => <span key={series.label}><i style={{ background: series.color }} />{series.label}</span>)}<span>{t("Dashed: reserve ")}{t(rupees(reserve))}</span></figcaption>
  </figure>;
}

export function DailyTable({ series }) {
  useLanguage();
  const available = series.filter(series => series.daily?.length);
  if (!available.length) return null;
  const maps = available.map(series => new Map(series.daily.map(day => [day.date, day.closingCashPaise])));
  return <details className="decision-details"><summary>{t("Inspect every forecast day")}</summary><div className="decision-table-wrap"><table><caption>{t("Daily closing cash in INR")}</caption><thead><tr><th scope="col">{t("Date")}</th>{available.map(series => <th scope="col" key={series.label}>{series.label}</th>)}</tr></thead>
    <tbody>{available[0].daily.map(day => <tr key={day.date}><th scope="row">{t(day.date)}</th>{maps.map((map, index) => <td key={index}>{t(rupees(map.get(day.date)))}</td>)}</tr>)}</tbody></table></div></details>;
}
