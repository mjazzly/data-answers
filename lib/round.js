// One rounding rule for every number the system gives, shared by the truth generator and the
// server so an expected value and a computed value can never differ by a rounding step.
// Amounts travel as whole cents; every division is done on integers and rounded half away
// from zero to two places. Nothing here touches a floating point division.

// hundredths = round(n * mult / d), half away from zero, on integers
export function divideHundredths(n, d, mult) {
  if (d === 0) return null;
  const num = BigInt(Math.round(n)) * BigInt(mult), den = BigInt(d);
  const neg = (num < 0n) !== (den < 0n);
  const an = num < 0n ? -num : num, ad = den < 0n ? -den : den;
  let q = an / ad; const r = an % ad;
  if (r * 2n >= ad) q += 1n;
  return Number(neg ? -q : q);
}
// a count of hundredths as a string with two places, e.g. 123450 -> "1234.50", -750 -> "-7.50"
export function fmt2(hundredths) {
  if (hundredths == null) return null;
  const neg = hundredths < 0, h = Math.abs(hundredths);
  return `${neg ? "-" : ""}${Math.trunc(h / 100)}.${String(h % 100).padStart(2, "0")}`;
}
export const amount = (cents) => fmt2(cents);                                   // cents -> "x.xx"
export const ratePct = (part, whole) => fmt2(divideHundredths(part, whole, 10000)); // part/whole as a percent
export const average = (cents, count) => fmt2(divideHundredths(cents, count, 1));    // cents/count as an amount
export const growthPct = (cur, prev) => fmt2(divideHundredths(cur - prev, prev, 10000));
