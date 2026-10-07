/**
 * Form-value coercion helpers.
 *
 * Ant Design `Input type="number"` yields strings; the backend DTOs expect
 * numbers for numeric fields. These helpers convert a set of keys to numbers
 * (or undefined when empty) so request bodies match the API contract.
 */

export function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Convert the listed keys of an object to numbers, leaving others untouched. */
export function toNumeric<T extends Record<string, unknown>>(
  values: T,
  keys: (keyof T)[],
): T {
  const out: Record<string, unknown> = { ...values };
  for (const key of keys) {
    out[key as string] = num(values[key]);
  }
  return out as T;
}

/** Drop keys whose value is undefined so PATCH bodies stay minimal. */
export function compact<T extends Record<string, unknown>>(values: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out as Partial<T>;
}
