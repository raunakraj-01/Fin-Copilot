export function roundBasisPoints(paise, basisPoints) {
  if (!Number.isSafeInteger(paise) || paise < 0 || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) throw new RangeError('Invalid amount or rate');
  const result = (BigInt(paise) * BigInt(basisPoints) + 5000n) / 10000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount exceeds safe integer range');
  return Number(result);
}
export function quoteDiscount(outstandingPaise, discountBps) {
  const discountPaise = roundBasisPoints(outstandingPaise, discountBps);
  return { outstandingPaise, discountBps, discountPaise, buyerPaysPaise: outstandingPaise - discountPaise };
}
