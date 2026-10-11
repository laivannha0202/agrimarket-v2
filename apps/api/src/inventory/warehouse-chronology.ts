/**
 * Chronology rule for demo/initial-stock intake.
 *
 * A lot's warehouse-in event must come AFTER its harvest, packing (+8h) and
 * QC (+9h) — otherwise the traceability timeline shows goods arriving at the
 * warehouse before they were picked. Centralised here so the seed and any
 * future backfill use the same offsets, and unit-tested so a fixed "one date
 * for every lot" shortcut cannot silently return.
 */
export const PACK_DELAY_HOURS = 8;
export const QC_DELAY_HOURS = 9;
export const INBOUND_DELAY_HOURS = 24;

export function packedAt(harvestDate: Date): Date {
  return new Date(harvestDate.getTime() + PACK_DELAY_HOURS * 3_600_000);
}

export function inspectedAt(harvestDate: Date): Date {
  return new Date(harvestDate.getTime() + QC_DELAY_HOURS * 3_600_000);
}

/** Business date of the inbound document / WAREHOUSE_IN trace event. */
export function inboundCompletedAt(harvestDate: Date): Date {
  return new Date(harvestDate.getTime() + INBOUND_DELAY_HOURS * 3_600_000);
}
