/** Small rational arithmetic boundary for stored decimal strings. Never round
 * before comparing a target; fractions remain internal and are not JSON data. */
export type Exact = { n: bigint; d: bigint };
function gcd(a: bigint, b: bigint): bigint { return b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b); }
export function fraction(n: bigint, d = 1n): Exact {
  if (d === 0n) throw new Error("zero denominator");
  const sign = d < 0n ? -1n : 1n;
  const divisor = gcd(n, d);
  return { n: n / divisor * sign, d: d / divisor * sign };
}
export function decimal(value: string): Exact {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error("finite decimal required");
  const [whole, digits = ""] = value.replace(/^-/, "").split(".");
  return fraction(BigInt(whole + digits) * (value.startsWith("-") ? -1n : 1n), 10n ** BigInt(digits.length));
}
export function add(a: Exact, b: Exact) { return fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
export function subtract(a: Exact, b: Exact) { return fraction(a.n * b.d - b.n * a.d, a.d * b.d); }
export function multiply(a: Exact, b: Exact) { return fraction(a.n * b.n, a.d * b.d); }
export function divide(a: Exact, b: Exact) { return fraction(a.n * b.d, a.d * b.n); }
export function compare(a: Exact, b: Exact): -1 | 0 | 1 { const difference = a.n * b.d - b.n * a.d; return difference < 0n ? -1 : difference > 0n ? 1 : 0; }
export function sum(values: Exact[]) { return values.reduce(add, fraction(0n)); }
export function textDecimal(value: Exact, places = 12) {
  const scale = 10n ** BigInt(places);
  const magnitude = value.n < 0n ? -value.n : value.n;
  const rounded = (magnitude * scale * 2n + value.d) / (value.d * 2n);
  const whole = rounded / scale;
  const tail = places ? (rounded % scale).toString().padStart(places, "0").replace(/0+$/, "") : "";
  return `${value.n < 0n && rounded !== 0n ? "-" : ""}${whole}${tail ? `.${tail}` : ""}`;
}
export function percentToBps(value: string) {
  const exact = multiply(decimal(value), fraction(100n));
  if (exact.d !== 1n || exact.n < 0n || exact.n > 10000n) throw new Error("比率は0〜100%、小数第2位までで入力してください。");
  return Number(exact.n);
}
