// Isolated test oracle only. Production imports Person 1's shared forecast.js.
export function buildForecast({ asOfDate, horizonDays = 90, openingCashPaise, minimumReservePaise = 0, cashItems = [], recurringRules = [], additionalEvents = [] }) {
  const movements = new Map();
  const warnings = [];
  function add(date, direction, amount) {
    const current = movements.get(date) ?? { in: 0, out: 0 };
    current[direction] += amount;
    movements.set(date, current);
  }
  for (const item of cashItems) {
    if (['paid', 'cancelled'].includes(item.status)) continue;
    if (!item.expectedDate || item.expectedDate < asOfDate || item.confidenceState === 'needs_review') { warnings.push(`Review required: ${item.id}`); continue; }
    const amount = item.amountPaise - (item.settledPaise ?? 0);
    if (amount > 0) add(item.expectedDate, item.category === 'receivable' ? 'in' : 'out', amount);
  }
  for (const event of additionalEvents) add(event.date, event.direction, event.amountPaise);
  let cash = openingCashPaise;
  const daily = Array.from({ length: horizonDays }, (_, index) => {
    const cursor = new Date(`${asOfDate}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + index);
    const date = cursor.toISOString().slice(0, 10);
    for (const rule of recurringRules) {
      if (rule.active !== false && cursor.getUTCDate() === rule.dayOfMonth && date >= rule.startsOn && (!rule.endsOn || date <= rule.endsOn)) add(date, 'out', rule.amountPaise);
    }
    const movement = movements.get(date) ?? { in: 0, out: 0 };
    cash += movement.in - movement.out;
    return { date, receiptsPaise: movement.in, paymentsPaise: movement.out, closingCashPaise: cash };
  });
  return { asOfDate, horizonDays, openingCashPaise, minimumReservePaise, daily, warnings, assumptions: ['Expected dates are owner assumptions'] };
}
