import type { Prisma } from '../../../generated/prisma/client.js';

/**
 * Atomic daily-code counters (`code_sequences`).
 *
 * WHY a counter table and not `MAX(code) + 1`: concurrent checkouts all read the
 * same maximum, build the same code and collide on the unique index; the retry
 * storm then interleaves with the checkout write set and produces deadlocks
 * (MySQL 1213 / Prisma P2034) and transaction timeouts (P2028) instead of two
 * orders.
 *
 * WHY raw SQL and not `prisma.codeSequence.upsert()`: Prisma compiles `upsert`
 * into `SELECT` followed by `INSERT`/`UPDATE` (verified against MySQL 8 through
 * `@prisma/adapter-mariadb`), so two transactions can both miss the row and both
 * try to insert — 5 of 20 concurrent claimers failed with a duplicate-key error.
 * A single `INSERT ... ON DUPLICATE KEY UPDATE` is one statement and therefore
 * atomic: every writer queues on the row's exclusive lock and leaves with a
 * distinct number. Verified: 20 concurrent claimers, 20 distinct values, 0
 * errors.
 *
 * `floor` is the highest sequence the caller can currently see. It is folded in
 * with `GREATEST` so the counter can only move forward: if it ever falls behind
 * the truth (an order written by a path that does not use the counter, a
 * restored backup, a counter reset) the very next claim jumps past it and hands
 * out a free number instead of a colliding one. Without this the collision would
 * only surface as a unique-index error and cost a retry.
 */
export async function claimSequence(
  tx: Prisma.TransactionClient,
  name: string,
  floor = 0,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO code_sequences (name, value, updated_at)
    VALUES (${name}, ${floor + 1}, UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE value = GREATEST(value, ${floor}) + 1, updated_at = UTC_TIMESTAMP(3)
  `;
  const rows = await tx.$queryRaw<{ value: bigint | number }[]>`
    SELECT value FROM code_sequences WHERE name = ${name}
  `;
  if (rows.length === 0) {
    // Unreachable: the statement above either inserted the row or updated it,
    // and both happen inside the caller's transaction.
    throw new Error(`Code sequence ${name} could not be claimed`);
  }
  return Number(rows[0].value);
}
