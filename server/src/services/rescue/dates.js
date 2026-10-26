export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(value, days) {
  if (!validDate(value) || !Number.isInteger(days)) throw new RangeError('Invalid date or day count');
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function horizonEnd(asOfDate, horizonDays) {
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366) {
    throw new RangeError('horizonDays must be between 1 and 366');
  }
  return addDays(asOfDate, horizonDays - 1);
}
