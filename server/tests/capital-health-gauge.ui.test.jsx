// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CapitalHealthGauge, { computeResilienceScore } from '../../client/src/components/CapitalHealthGauge.jsx';

afterEach(cleanup);

it('renders the Capital Health Gauge active arc proportional to score instead of fixed 75%', () => {
  const forecast45 = {
    asOfDate: '2026-11-01',
    openingCashPaise: 100_000,
    minimumReservePaise: 50_000,
    risk: { firstNegativeDate: '2026-11-12', worstCashPaise: -10_000 },
    daily: [],
    cashDesk: { dataFreshness: { staleDays: 0 } },
  };
  const { score } = computeResilienceScore(forecast45);
  expect(score).toBe(45);

  const { container } = render(<CapitalHealthGauge forecast={forecast45} />);
  expect(screen.getByRole('img', { name: 'Capital Health Score 45 out of 100' })).toBeTruthy();

  const circumference = 2 * Math.PI * 54;
  const trackArc = circumference * 0.75;
  const expectedActiveArc = (45 / 100) * trackArc;

  const track = container.querySelector('.gauge-track');
  const bar = container.querySelector('.gauge-bar');
  expect(track.getAttribute('stroke-dasharray')).toBe(`${trackArc} ${circumference}`);
  expect(bar.getAttribute('stroke-dasharray')).toBe(`${expectedActiveArc} ${circumference}`);
  expect(bar.getAttribute('stroke-dashoffset')).toBe('0');
});
