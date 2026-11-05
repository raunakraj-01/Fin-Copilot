export function parseInrPaise(value) {
  const clean = String(value ?? '').trim().replace(/[₹\s]/g, '');
  const negative = clean.startsWith('-');
  const unsigned = negative ? clean.slice(1) : clean;
  if (!/^(?:\d+|\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(unsigned)) throw new Error('Invalid INR amount');
  const [whole, fraction = ''] = unsigned.replaceAll(',', '').split('.');
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INR amount is too large');
  return Number(negative ? -paise : paise);
}
