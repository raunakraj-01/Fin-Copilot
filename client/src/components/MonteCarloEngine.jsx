import React, { useState, useMemo } from 'react';
import { t, locale } from '../i18n/index.js';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';

const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100);

export default function MonteCarloEngine({ forecast, onClose }) {
  const [iterations, setIterations] = useState(1000);
  const [volatility, setVolatility] = useState('medium'); // low (std=3), medium (std=7), high (std=14)
  const [running, setRunning] = useState(false);
  const [simResults, setSimResults] = useState(null);

  // Standard deviation in days based on volatility
  const stdDays = volatility === 'low' ? 3 : volatility === 'high' ? 14 : 7;

  // Box-Muller Gaussian random generator
  function randomGaussian(mean = 0, stdev = 1) {
    let u = 1 - Math.random();
    let v = Math.random();
    let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + z * stdev;
  }

  function runSimulation() {
    if (!forecast || !forecast.daily) return;
    setRunning(true);

    setTimeout(() => {
      const dates = forecast.daily.map(d => d.date);
      const openingCashPaise = forecast.openingCashPaise;
      const reservePaise = forecast.minimumReservePaise || 0;
      const numDays = dates.length;

      // Extract raw events
      const rawInflows = [];
      const fixedOutflowDaily = new Array(numDays).fill(0);

      forecast.daily.forEach((d, dayIdx) => {
        (d.events || []).forEach(e => {
          if (e.direction === 'in') {
            rawInflows.push({ dayIdx, amount: e.amountPaise, confidence: e.confidenceState });
          } else {
            fixedOutflowDaily[dayIdx] += e.amountPaise;
          }
        });
      });

      // Storage for daily balances across all runs: matrix [dayIdx][runIdx]
      const dailyCashRuns = Array.from({ length: numDays }, () => new Float64Array(iterations));
      let deficitRunsCount = 0;
      let reserveBreachRunsCount = 0;
      const minBalances = new Float64Array(iterations);

      for (let run = 0; run < iterations; run++) {
        const inflowDaily = new Array(numDays).fill(0);

        for (let j = 0; j < rawInflows.length; j++) {
          const item = rawInflows[j];
          // Verified items have tight variance; unverified or owner assumption items have larger variance
          const itemStd = item.confidence === 'verified' ? stdDays * 0.4 : stdDays;
          // Payments only slip positively or minimally early (skewed right)
          const delay = Math.max(-2, Math.round(Math.abs(randomGaussian(0, itemStd))));
          const targetDay = Math.min(numDays - 1, item.dayIdx + delay);
          inflowDaily[targetDay] += item.amount;
        }

        let currentCash = openingCashPaise;
        let runMin = currentCash;
        let hadDeficit = false;
        let hadBreach = false;

        for (let d = 0; d < numDays; d++) {
          currentCash = currentCash + inflowDaily[d] - fixedOutflowDaily[d];
          dailyCashRuns[d][run] = currentCash;
          if (currentCash < runMin) runMin = currentCash;
          if (currentCash < 0) hadDeficit = true;
          if (currentCash < reservePaise) hadBreach = true;
        }

        minBalances[run] = runMin;
        if (hadDeficit) deficitRunsCount++;
        if (hadBreach) reserveBreachRunsCount++;
      }

      // Compute percentiles for each day: P10 (pessimistic), P50 (median), P90 (optimistic)
      const corridor = dates.map((date, d) => {
        const dayValues = Array.from(dailyCashRuns[d]).sort((a, b) => a - b);
        const p10 = dayValues[Math.floor(iterations * 0.1)];
        const p50 = dayValues[Math.floor(iterations * 0.5)];
        const p90 = dayValues[Math.floor(iterations * 0.9)];
        const baseline = forecast.daily[d]?.closingCashPaise || 0;
        return {
          date,
          p10,
          p50,
          p90,
          baseline,
          reserve: reservePaise,
        };
      });

      // Sort min balances to find Value-at-Risk at 95% confidence (5th percentile)
      const sortedMinBalances = Array.from(minBalances).sort((a, b) => a - b);
      const var95 = sortedMinBalances[Math.floor(iterations * 0.05)];
      const deficitProb = Number(((deficitRunsCount / iterations) * 100).toFixed(1));
      const breachProb = Number(((reserveBreachRunsCount / iterations) * 100).toFixed(1));

      setSimResults({
        corridor,
        var95,
        deficitProb,
        breachProb,
        iterations,
        volatility,
      });
      setRunning(false);
    }, 80);
  }

  return (
    <div className="card monte-carlo-card">
      <div className="monte-carlo-header">
        <div>
          <span className="monte-carlo-kicker">STOCHASTIC FINANCIAL ENGINEERING</span>
          <h2>Monte Carlo Liquidity Risk Engine (1,000 Iterations)</h2>
          <p className="monte-carlo-caption">
            Simulates stochastic customer payment timing distributions across 1,000 randomized forecast paths to compute statistical confidence corridors and Liquidity Value-at-Risk (L-VaR).
          </p>
        </div>
        {onClose && (
          <button type="button" className="secondary" onClick={onClose}>
            ✕ Close Engine
          </button>
        )}
      </div>

      {/* Control Bar */}
      <div className="monte-carlo-controls">
        <label>
          Payment Delay Volatility (σ)
          <select value={volatility} onChange={e => setVolatility(e.target.value)}>
            <option value="low">Low Volatility (σ = 3 Days · Prompt Debtor Base)</option>
            <option value="medium">Medium Volatility (σ = 7 Days · Mixed Indian SME Credit)</option>
            <option value="high">High Volatility (σ = 14 Days · High Delay Risk)</option>
          </select>
        </label>

        <label>
          Stochastic Paths
          <select value={iterations} onChange={e => setIterations(Number(e.target.value))}>
            <option value={500}>500 Iterations (Fast)</option>
            <option value={1000}>1,000 Iterations (Recommended Standard)</option>
            <option value={2000}>2,000 Iterations (High Statistical Precision)</option>
          </select>
        </label>

        <button
          type="button"
          className="primary"
          disabled={running}
          onClick={runSimulation}
          style={{ alignSelf: 'end' }}
        >
          {running ? 'Running 1,000 Paths…' : '▶ Execute Monte Carlo Simulation'}
        </button>
      </div>

      {/* Simulation Results Display */}
      {simResults && (
        <div className="monte-carlo-results">
          {/* Key Risk Metrics */}
          <div className="monte-carlo-kpis">
            <div className="monte-kpi">
              <small>Deficit Probability P(Cash &lt; 0)</small>
              <strong className={simResults.deficitProb > 20 ? 'text-danger' : 'text-success'}>
                {simResults.deficitProb}%
              </strong>
              <span>Risk of hitting negative cash</span>
            </div>

            <div className="monte-kpi">
              <small>Reserve Breach P(Cash &lt; Reserve)</small>
              <strong className={simResults.breachProb > 40 ? 'text-danger' : 'text-warning'}>
                {simResults.breachProb}%
              </strong>
              <span>Probability of breaking safety buffer</span>
            </div>

            <div className="monte-kpi">
              <small>Liquidity Value-at-Risk (95% L-VaR)</small>
              <strong className={simResults.var95 < 0 ? 'text-danger' : ''}>
                {money(simResults.var95)}
              </strong>
              <span>5th percentile worst projected balance</span>
            </div>

            <div className="monte-kpi">
              <small>Sampled Paths</small>
              <strong>{simResults.iterations.toLocaleString()} Runs</strong>
              <span>Empirical Box-Muller Gaussian Skew</span>
            </div>
          </div>

          {/* Probabilistic Fan Chart */}
          <div className="monte-chart-wrapper">
            <div className="chart-legend-row">
              <span className="legend-item"><i style={{ background: '#10b981' }} /> P90 (Optimistic 90th Percentile)</span>
              <span className="legend-item"><i style={{ background: '#3b82f6' }} /> P50 (Median Expected Runway)</span>
              <span className="legend-item"><i style={{ background: '#ef4444' }} /> P10 (Pessimistic Stress Floor)</span>
              <span className="legend-item"><i style={{ background: '#275e80', borderStyle: 'dotted' }} /> Deterministic Baseline</span>
            </div>

            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={simResults.corridor} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="p90Grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="p10Grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tickFormatter={v => v.slice(5)} minTickGap={20} />
                  <YAxis tickFormatter={v => `${Math.round(v / 100000)}L`} />
                  <Tooltip formatter={v => money(v)} />
                  <ReferenceLine y={0} stroke="#a43d41" strokeDasharray="4 4" />
                  <ReferenceLine y={forecast.minimumReservePaise || 0} stroke="#f59e0b" strokeDasharray="3 3" />
                  {/* Corridors */}
                  <Area type="monotone" dataKey="p90" stroke="#10b981" strokeWidth={1.5} fillOpacity={1} fill="url(#p90Grad)" name="P90 (Optimistic)" />
                  <Area type="monotone" dataKey="p50" stroke="#3b82f6" strokeWidth={2} fillOpacity={0} name="P50 (Median)" />
                  <Area type="monotone" dataKey="p10" stroke="#ef4444" strokeWidth={1.8} fillOpacity={1} fill="url(#p10Grad)" name="P10 (Pessimistic Floor)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
