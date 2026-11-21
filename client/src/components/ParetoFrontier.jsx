import React from 'react';
import { t, locale } from '../i18n/index.js';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, ReferenceLine, Cell } from 'recharts';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100);

export default function ParetoFrontier({ plans = [], baselineWorstCashPaise = 0, reservePaise = 0 }) {
  if (!plans || plans.length === 0) return null;

  // Map each plan to an (x: cost, y: worstCash) point
  const data = plans.map((p, idx) => ({
    name: `Plan ${idx + 1}`,
    cost: (p.knownActionCostPaise || 0) / 100,
    worstCash: p.worstCashPaiseAfter / 100,
    costPaise: p.knownActionCostPaise || 0,
    worstCashPaise: p.worstCashPaiseAfter,
    actionsCount: (p.actions || []).length,
    feasible: p.fullyFeasible,
  }));

  // Identify Pareto-efficient points:
  // A plan A dominates plan B if Cost(A) <= Cost(B) and WorstCash(A) >= WorstCash(B) with at least one strict inequality.
  const paretoData = data.map(item => {
    const isDominated = data.some(
      other =>
        other !== item &&
        other.cost <= item.cost &&
        other.worstCash >= item.worstCash &&
        (other.cost < item.cost || other.worstCash > item.worstCash)
    );
    return {
      ...item,
      isPareto: !isDominated,
    };
  });

  return (
    <article className="decision-card pareto-frontier-card" aria-label="Pareto Optimal Frontier">
      <div className="pareto-header">
        <div>
          <span className="decision-kicker">MULTI-OBJECTIVE OPTIMIZATION</span>
          <h2>Pareto Optimization Frontier (Fee Cost vs Liquidity Preservation)</h2>
          <p className="decision-muted">
            Formal Pareto-optimal tradeoff frontier plotting action execution fees against resulting cash headroom. Points on the frontier represent mathematically non-dominated policy options.
          </p>
        </div>
        <span className="decision-badge">
          {paretoData.filter(d => d.isPareto).length} of {plans.length} Pareto Efficient
        </span>
      </div>

      <div style={{ width: '100%', height: 260, marginTop: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              type="number"
              dataKey="cost"
              name="Action Fees"
              unit="₹"
              tickFormatter={v => `₹${v}`}
              label={{ value: 'Total Incurred Action Fees (₹)', position: 'insideBottom', offset: -10, fontSize: 12 }}
            />
            <YAxis
              type="number"
              dataKey="worstCash"
              name="Lowest Cash"
              tickFormatter={v => `${Math.round(v / 1000)}k`}
              label={{ value: 'Projected Lowest Cash (₹)', angle: -90, position: 'insideLeft', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload;
                  return (
                    <div className="custom-chart-tooltip" style={{ background: 'var(--surface)', padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                      <strong>{d.name}</strong>
                      <div>Cost: {money(d.costPaise)}</div>
                      <div>Lowest Cash: {money(d.worstCashPaise)}</div>
                      <div>Actions: {d.actionsCount}</div>
                      <div>Status: {d.isPareto ? '⭐ Pareto Optimal' : 'Sub-Optimal'}</div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <ReferenceLine y={0} stroke="#a43d41" strokeDasharray="4 4" />
            {reservePaise > 0 && <ReferenceLine y={reservePaise / 100} stroke="#f59e0b" strokeDasharray="3 3" label="Reserve" />}
            <Scatter name="Rescue Plans" data={paretoData}>
              {paretoData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isPareto ? '#10b981' : '#94a3b8'}
                  stroke={entry.isPareto ? '#059669' : '#64748b'}
                  strokeWidth={2}
                  r={entry.isPareto ? 8 : 5}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div className="pareto-legend-row" style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#10b981', marginRight: 4 }} /> Pareto Efficient Plan</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#94a3b8', marginRight: 4 }} /> Dominated Candidate</span>
      </div>
    </article>
  );
}
