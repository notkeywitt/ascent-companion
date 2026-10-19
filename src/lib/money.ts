/**
 * Dollars as the app shows them. Forty pages each wrote their own formatter,
 * and the hand-built ones put the minus inside the sign ("$-1,234.00") and
 * followed the browser's locale. One rule now: en-US, minus before the sign.
 *
 * A missing value (null, undefined, NaN) shows as "—", never as "$0.00": an
 * unknown amount is not a zero one.
 */

const fmt = (n: number, digits: number) =>
  (n < 0 ? "-$" : "$") +
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const value = (n: number | null | undefined) =>
  n == null ? NaN : typeof n === "number" ? n : Number(n);

/** "$1,234.56" — every amount a person reads or checks. */
export function money(n: number | null | undefined): string {
  const v = value(n);
  return Number.isFinite(v) ? fmt(v, 2) : "—";
}

/** "$1,235" — whole dollars, for a wide grid or a chart where cents are noise. */
export function money0(n: number | null | undefined): string {
  const v = value(n);
  return Number.isFinite(v) ? fmt(v, 0) : "—";
}
