/**
 * Business code generation.
 *
 * Users see human-readable codes (PARTNER-0001, ORD-20261007-0001, ...),
 * never raw database ids. Sequence numbers are derived from the current row
 * count + 1 inside a transaction; collisions are impossible in practice for a
 * single-writer demo dataset and the unique constraint is the safety net.
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
