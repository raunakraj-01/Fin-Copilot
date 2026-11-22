import React, { useState, useMemo } from 'react';
import { t, locale } from '../i18n/index.js';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100);

export default function WhatIfSimulator({ forecast, onClose }) {
  const [debtorDelayDays, setDebtorDelayDays] = useState(7);
  const [emergencyExpenseInr, setEmergencyExpenseInr] = useState(50000);
  const [customReserveInr, setCustomReserveInr] = useState(() => Math.round((forecast?.minimumReservePaise || 0) / 100));

  // Recalculate daily scenario dynamically with client-side integer arithmetic
  const simulation = useMemo(() => {
    if (!forecast || !forecast.daily) return null;
    const openingCashPaise = forecast.openingCashPaise;
    const targetReservePaise = customReserveInr * 100;
    const emergencyPaise = emergencyExpenseInr * 100;

    // Build timeline of events with the delay and shock applied
    const dayMap = new Map();
    forecast.daily.forEach(d => {
      dayMap.set(d.date, { date: d.date, inflows: 0, outflows: 0 });
    });

    const dates = forecast.daily.map(d => d.date);
    const dateToIndex = new Map(dates.map((d, i) => [d, i]));

    // Distribute existing events with customer delay
    forecast.daily.forEach((d, dayIdx) => {
      (d.events || []).forEach(e => {
        if (e.direction === 'in') {
          // Delayed customer collection
          const newIdx = dayIdx + debtorDelayDays;
          if (newIdx < dates.length) {
            const targetDate = dates[newIdx];
            const entry = dayMap.get(targetDate);
            if (entry) entry.inflows += e.amountPaise;
          }
        } else {
          // Outflow stays on its original due date
          const entry = dayMap.get(d.date);
          if (entry) entry.outflows += e.amountPaise;
        }
      });
    });

    // Add emergency shock on day 5 (or first available day)
    if (emergencyPaise > 0 && dates.length > 5) {
      const shockDate = dates[5];
      const entry = dayMap.get(shockDate);
      if (entry) entry.outflows += emergencyPaise;
    }

    // Roll forward daily cash balance
    let runningCash = openingCashPaise;
    let worstCashPaise = runningCash;
    let worstDate = dates[0];
    let firstNegativeDate = null;
    let firstReserveBreachDate = null;

    const simulatedDaily = dates.map(d => {
      const entry = dayMap.get(d);
      runningCash = runningCash + entry.inflows - entry.outflows;

      if (runningCash < worstCashPaise) {
        worstCashPaise = runningCash;
        worstDate = d;
      }
      if (runningCash < 0 && !firstNegativeDate) {
        firstNegativeDate = d;
      }
      if (runningCash < targetReservePaise && !firstReserveBreachDate) {
        firstReserveBreachDate = d;
      }

      const originalDay = forecast.daily.find(orig => orig.date === d);

      return {
        date: d,
        baselineCash: originalDay ? originalDay.closingCashPaise : runningCash,
        simulatedCash: runningCash,
      };
    });

    return {
      simulatedDaily,
      worstCashPaise,
      worstDate,
      firstNegativeDate,
      firstReserveBreachDate,
      targetReservePaise,
    };
  }, [forecast, debtorDelayDays, emergencyExpenseInr, customReserveInr]);

  if (!simulation) return null;

  const originalWorst = forecast.risk?.worstCashPaise ?? 0;
  const deltaWorst = simulation.worstCashPaise - originalWorst;

  return (
    <div className="card whatif-sandbox-card">
      <div className="whatif-header">
        <div>
          <span className="whatif-kicker">INTERACTIVE SCENARIO SANDBOX</span>
          <h2>Live Liquidity Stress Simulator</h2>
          <p className="whatif-caption">
            Manipulate customer collection delays and emergency outflow shocks in real time to observe the impact on your capital reserve.
          </p>
        </div>
        {onClose && (
          <button type="button" className="secondary" onClick={onClose}>
            ✕ Close Sandbox
          </button>
        )}
      </div>

      {/* Control Sliders Grid */}
      <div className="whatif-controls-grid">
        <div className="whatif-control-item">
          <div className="control-label-row">
            <span>Customer Delay Slip</span>
            <strong>+{debtorDelayDays} Days</strong>
          </div>
          <input
            type="range"
            min="0"
            max="30"
            step="1"
            value={debtorDelayDays}
            onChange={e => setDebtorDelayDays(Number(e.target.value))}
          />
          <small className="control-hint">All dated receivables pushed back by {debtorDelayDays} calendar days.</small>
        </div>

        <div className="whatif-control-item">
          <div className="control-label-row">
            <span>Emergency Outflow Shock</span>
            <strong>{money(emergencyExpenseInr * 100)}</strong>
          </div>
          <input
            type="range"
            min="0"
            max="500000"
            step="10000"
            value={emergencyExpenseInr}
            onChange={e => setEmergencyExpenseInr(Number(e.target.value))}
          />
          <small className="control-hint">Unplanned machine breakdown or tax demand simulated on Day 5.</small>
        </div>

        <div className="whatif-control-item">
          <div className="control-label-row">
            <span>Safety Reserve Buffer</span>
            <strong>{money(customReserveInr * 100)}</strong>
          </div>
          <input
            type="range"
            min="0"
            max="1000000"
            step="25000"
            value={customReserveInr}
            onChange={e => setCustomReserveInr(Number(e.target.value))}
          />
          <small className="control-hint">Minimum threshold required before triggering critical breach.</small>
        </div>
      </div>

      {/* Real-time KPI Comparison Bar */}
      <div className="whatif-metrics-bar">
        <div className="whatif-metric">
          <small>Stressed Worst Cash</small>
          <strong className={simulation.worstCashPaise < 0 ? 'text-danger' : ''}>
            {money(simulation.worstCashPaise)}
          </strong>
          <span>Worst Date: {simulation.worstDate}</span>
        </div>
        <div className="whatif-metric">
          <small>Capital Deficit Shift</small>
          <strong className={deltaWorst < 0 ? 'text-danger' : 'text-success'}>
            {deltaWorst < 0 ? '-' : '+'}{money(Math.abs(deltaWorst))}
          </strong>
          <span>vs Baseline Forecast</span>
        </div>
        <div className="whatif-metric">
          <small>Simulated Zero-Cash Day</small>
          <strong>{simulation.firstNegativeDate || 'None in 90 Days'}</strong>
          <span>First Deficit Event</span>
        </div>
        <div className="whatif-metric">
          <small>Reserve Status</small>
          <strong>
            {simulation.worstCashPaise >= simulation.targetReservePaise ? (
              <span className="text-success">Shield Preserved</span>
            ) : (
              <span className="text-danger">Buffer Breached</span>
            )}
          </strong>
          <span>Threshold: {money(simulation.targetReservePaise)}</span>
        </div>
      </div>

      {/* Overlay Comparison Chart */}
      <div className="whatif-chart-wrapper">
        <div className="chart-legend-row">
          <span className="legend-item"><i style={{ background: '#275e80' }} /> Baseline Actual</span>
          <span className="legend-item"><i style={{ background: '#e11d48' }} /> Simulated Stress Curve</span>
          <span className="legend-item"><i style={{ background: '#f59e0b', borderStyle: 'dashed' }} /> Target Reserve</span>
        </div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={simulation.simulatedDaily} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="baselineGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#275e80" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#275e80" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="simulatedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e11d48" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#e11d48" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tickFormatter={v => v.slice(5)} minTickGap={20} />
              <YAxis tickFormatter={v => `${Math.round(v / 100000)}L`} />
              <Tooltip formatter={v => money(v)} />
              <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" />
              <ReferenceLine y={simulation.targetReservePaise} stroke="#f59e0b" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="baselineCash" stroke="#275e80" strokeWidth={2} fillOpacity={1} fill="url(#baselineGrad)" name="Baseline" />
              <Area type="monotone" dataKey="simulatedCash" stroke="#e11d48" strokeWidth={2.5} fillOpacity={1} fill="url(#simulatedGrad)" name="Simulated" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
