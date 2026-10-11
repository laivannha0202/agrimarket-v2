/**
 * Vietnamese mobile number normalisation and validation.
 *
 * Stored form is E.164-ish without the plus (`0912345678` → `84912345678`?
 * no — see below): the project stores the LOCAL 10-digit form
 * (`0XXXXXXXXX`), which is what the customer sees on their own order and what
 * the Admin screens already display.
 *
 * Accepted inputs (all normalise to the same 10-digit local number):
 *   - `0912345678`      plain local form
 *   - `091 234 5678`    spaces / dots / dashes are separators
 *   - `+84912345678`    international, with plus
 *   - `84912345678`     international, without plus
 *   - `8491 234 5678`   international with separators
 *
 * Rejected: wrong length, a leading digit outside the Vietnamese mobile
 * prefixes, or any other stray character.
 */

/** Vietnamese mobile prefixes (after the leading 0): 03,05,07,08,09. */
const MOBILE_PREFIXES = ['3', '5', '7', '8', '9'];

/**
 * Returns the canonical 10-digit local form, or `null` when the input is not a
 * valid Vietnamese mobile number.
 */
export function normalizeVietnamesePhone(input: string): string | null {
  if (typeof input !== 'string') return null;

  // Separators people actually type: spaces, dots, dashes, parentheses.
  const compact = input.replace(/[\s.\-()]/g, '');

  // `+84…` and `84…` both mean the same as a leading `0`.
  let local: string;
  if (compact.startsWith('+84')) local = `0${compact.slice(3)}`;
  else if (compact.startsWith('84') && compact.length > 10) local = `0${compact.slice(2)}`;
  else local = compact;

  if (!/^0\d{9}$/.test(local)) return null;
  if (!MOBILE_PREFIXES.includes(local[1])) return null;
  return local;
}

/** True when `input` is a valid Vietnamese mobile number in any accepted form. */
export function isValidVietnamesePhone(input: string): boolean {
  return normalizeVietnamesePhone(input) !== null;
}
