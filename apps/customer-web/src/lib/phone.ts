/**
 * Vietnamese mobile number normalisation and validation.
 *
 * A direct port of the backend `apps/api/src/common/utils/phone.util.ts`, kept
 * here so the Customer Web register form enforces the SAME rule the API does —
 * a number the API accepts must never be rejected by the form, and vice versa.
 * The backend remains the authority; this only saves the customer a round trip
 * with a clear message next to the field.
 */

/** Vietnamese mobile prefixes (after the leading 0): 03, 05, 07, 08, 09. */
const MOBILE_PREFIXES = ["3", "5", "7", "8", "9"];

/**
 * Returns the canonical 10-digit local form, or `null` when the input is not a
 * valid Vietnamese mobile number.
 *
 * Accepted (all normalise to `0XXXXXXXXX`): `0912345678`, `091 234 5678`,
 * `+84912345678`, `84912345678`.
 */
export function normalizeVietnamesePhone(input: string): string | null {
  if (typeof input !== "string") return null;

  const compact = input.replace(/[\s.\-()]/g, "");

  let local: string;
  if (compact.startsWith("+84")) local = `0${compact.slice(3)}`;
  else if (compact.startsWith("84") && compact.length > 10) local = `0${compact.slice(2)}`;
  else local = compact;

  if (!/^0\d{9}$/.test(local)) return null;
  if (!MOBILE_PREFIXES.includes(local.charAt(1))) return null;
  return local;
}

/** True when `input` is a valid Vietnamese mobile number in any accepted form. */
export function isValidVietnamesePhone(input: string): boolean {
  return normalizeVietnamesePhone(input) !== null;
}
