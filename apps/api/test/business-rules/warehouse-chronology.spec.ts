import { describe, expect, it } from 'vitest';
import {
  INBOUND_DELAY_HOURS,
  PACK_DELAY_HOURS,
  QC_DELAY_HOURS,
  inboundCompletedAt,
  inspectedAt,
  packedAt,
} from '../../src/inventory/warehouse-chronology.js';

/**
 * Traceability chronology guard.
 *
 * Regression test for the seed bug that stamped every lot's WAREHOUSE_IN
 * event with one fixed date, putting warehouse arrival BEFORE the harvest
 * for 13 of 19 lots. The rule: harvest < pack (+8h) < QC (+9h) < inbound
 * (+24h), always derived from the lot's own harvest date.
 */
describe('warehouse chronology', () => {
  const harvest = new Date('2026-10-02T01:00:00.000Z');

  it('orders pack, QC and inbound strictly after the harvest', () => {
    expect(packedAt(harvest).getTime()).toBe(harvest.getTime() + PACK_DELAY_HOURS * 3_600_000);
    expect(inspectedAt(harvest).getTime()).toBe(harvest.getTime() + QC_DELAY_HOURS * 3_600_000);
    const inbound = inboundCompletedAt(harvest).getTime();
    expect(inbound).toBe(harvest.getTime() + INBOUND_DELAY_HOURS * 3_600_000);
    expect(harvest.getTime()).toBeLessThan(packedAt(harvest).getTime());
    expect(packedAt(harvest).getTime()).toBeLessThan(inspectedAt(harvest).getTime());
    expect(inspectedAt(harvest).getTime()).toBeLessThan(inbound);
  });

  it('derives the inbound date from each harvest, never a shared constant', () => {
    const early = new Date('2026-09-21T01:00:00.000Z');
    const late = new Date('2026-10-03T01:00:00.000Z');
    // Different harvests => different inbound dates, each after its harvest.
    expect(inboundCompletedAt(early).getTime()).toBeLessThan(inboundCompletedAt(late).getTime());
    expect(inboundCompletedAt(late).getTime()).toBeGreaterThan(late.getTime());
    expect(inboundCompletedAt(early).getTime()).toBeGreaterThan(early.getTime());
  });
});
