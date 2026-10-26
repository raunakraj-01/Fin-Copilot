export function parseInrPaise(value) {
  const clean = String(value ?? '').trim().replace(/[₹,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) throw new Error('Invalid INR amount');
  const negative = clean.startsWith('-');
  const [whole, fraction = ''] = (negative ? clean.slice(1) : clean).split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) throw new Error('INR amount is too large');
  return negative ? -paise : paise;
}
