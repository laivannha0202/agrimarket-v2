function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Split a refund amount across partner orders in proportion to gross value.
 *
 * Every non-last share is rounded to 2 decimals and the exact remainder goes to
 * the last line, so the attribution always sums to `amount` — no đồng is
 * created or lost by rounding. Used both when a refund is completed after a
 * settlement (to book one reconciliation row per partner order) and when a
 * settlement is built (to deduct completed refunds from the right lines).
 */
export function allocateByGross(
  amount: number,
  parts: { id: number; gross: number }[],
): Map<number, number> {
  const result = new Map<number, number>();
  if (parts.length === 0 || amount <= 0) return result;
  const totalGross = parts.reduce((sum, p) => sum + Math.max(p.gross, 0), 0);
  if (totalGross <= 0) {
    result.set(parts[0].id, round2(amount));
    return result;
  }
  let allocated = 0;
  parts.forEach((part, index) => {
    const share =
      index === parts.length - 1
        ? round2(amount - allocated)
        : round2((amount * Math.max(part.gross, 0)) / totalGross);
    allocated = round2(allocated + share);
    if (share > 0) result.set(part.id, share);
  });
  return result;
}
