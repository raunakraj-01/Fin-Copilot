export function parseRupees(raw) {
  const value = String(raw).trim().replace(/^₹\s*/, '');
  if (!/^(?:\d+|\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a valid rupee amount, such as ₹1,20,000 or 120000.50');
  const [whole, fraction = ''] = value.replaceAll(',', '').split('.');
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large');
  return Number(paise);
}
export function inputRupees(paise) {
  const value = BigInt(paise);
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
