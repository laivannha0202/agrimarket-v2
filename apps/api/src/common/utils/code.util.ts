/**
 * Business code generation.
 *
 * Users see human-readable codes (PARTNER-0001, ORD-20261007-0001, ...),
 * never raw database ids.
 *
 * Dated sequences (ORD/SHP/LOT) are derived from the highest existing sequence
 * for the same day rather than from a row count: `count() + 1` collides as soon
 * as a row is deleted, and two concurrent writers read the same count and build
 * the same code. The unique index on `code` stays the final safety net, and the
 * callers retry on a unique-constraint violation (see `isUniqueViolationOn`).
 */
export function formatSequence(n: number, width = 4): string {
  return String(n).padStart(width, '0');
}

export function dateStamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function buildCode(prefix: string, sequence: number, width = 4): string {
  return `${prefix}-${formatSequence(sequence, width)}`;
}

export function buildDatedCode(prefix: string, sequence: number, date: Date = new Date()): string {
  return `${prefix}-${dateStamp(date)}-${formatSequence(sequence)}`;
}

/** The `<PREFIX>-<YYYYMMDD>-` part shared by every code of one day. */
export function datedCodePrefix(prefix: string, date: Date = new Date()): string {
  return `${prefix}-${dateStamp(date)}-`;
}

/**
 * Next free sequence for `prefix` on `date`, given the codes that already
 * exist for that day (any order, possibly including foreign rows).
 *
 * Only the leading digits after the day stamp are read, so suffixed codes such
 * as `ORD-20261007-0003-P01` count as sequence 3 and never break parsing.
 */
export function nextDatedSequence(
  codes: readonly string[],
  prefix: string,
  date: Date = new Date(),
): number {
  const head = datedCodePrefix(prefix, date);
  let max = 0;
  for (const code of codes) {
    if (!code.startsWith(head)) continue;
    const match = /^(\d+)/.exec(code.slice(head.length));
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max + 1;
}

/**
 * Next free sequence for a non-dated `PREFIX-NNNN` code, given the codes that
 * already exist (any order, possibly including foreign rows).
 *
 * Same reasoning as `nextDatedSequence`: `count() + 1` reuses numbers as soon as
 * a row is deleted and races under concurrency.
 */
export function nextSequence(codes: readonly string[], prefix: string): number {
  const head = `${prefix}-`;
  let max = 0;
  for (const code of codes) {
    if (!code.startsWith(head)) continue;
    const match = /^(\d+)/.exec(code.slice(head.length));
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max + 1;
}

/**
 * Name(s) of the violated unique index behind a P2002, normalised to a
 * lowercase string.
 *
 * The shape depends on how Prisma talks to the database:
 *  - classic engine / most providers: `meta.target` is an array of column names
 *  - MySQL classic engine: `meta.target` is the index name (e.g. `orders_code_key`)
 *  - driver adapters (e.g. `@prisma/adapter-mariadb`): `meta.target` is absent
 *    and the index name arrives as
 *    `meta.driverAdapterError.cause.constraint.index` (`originalMessage` also
 *    carries `Duplicate entry … for key 'orders.orders_code_key'`)
 *
 * All of them are folded into one string so callers can match on a fragment.
 */
export function uniqueViolationTarget(error: unknown): string {
  const meta = (error as { meta?: unknown } | null)?.meta as
    | { target?: unknown; driverAdapterError?: unknown }
    | undefined;
  if (!meta) return '';

  const parts: string[] = [];
  if (Array.isArray(meta.target)) parts.push(meta.target.join(','));
  else if (typeof meta.target === 'string') parts.push(meta.target);

  const cause = (meta.driverAdapterError as { cause?: unknown } | undefined)?.cause as
    | {
        constraint?: { index?: unknown; fields?: unknown };
        originalMessage?: unknown;
      }
    | undefined;
  if (cause) {
    const index = cause.constraint?.index;
    if (typeof index === 'string') parts.push(index);
    const fields = cause.constraint?.fields;
    if (Array.isArray(fields)) parts.push(fields.join(','));
  }

  // Structured names first; the raw driver message is only a last resort (it
  // also quotes the offending value, which could produce a false match).
  if (parts.length > 0) return parts.join(',').toLowerCase();
  const original = cause?.originalMessage;
  return typeof original === 'string' ? original.toLowerCase() : '';
}

/**
 * True when `error` is a unique-constraint violation on one of `needles`.
 *
 * The needles are fragments of the violated index name (`code`,
 * `trace_code`, `checkout_idempotency_keys`, …), so ANY of them matching is
 * enough: `isUniqueViolationOn(error, 'code', 'trace_code')` must accept both
 * `product_lots_code_key` and `product_lots_trace_code_key`.
 */
export function isUniqueViolationOn(error: unknown, ...needles: string[]): boolean {
  if (!isUniqueViolation(error)) return false;
  const target = uniqueViolationTarget(error);
  if (target.length === 0) return false;
  return needles.some((needle) => target.includes(needle.toLowerCase()));
}

/** True for any Prisma unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}
