import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { EvidenceService, EVIDENCE_ORPHAN_TTL_MS } from './evidence.service.js';

/**
 * Periodically removes evidence uploads that were never bound to anything.
 *
 * WHY THIS EXISTS AT ALL
 *
 * An upload is created before the entity it belongs to (the customer is still
 * typing the reason), so an abandoned form leaves a file with no owner. Those
 * rows are unreachable by design — no read policy grants access to them — but
 * they would accumulate on disk forever without something to sweep them.
 *
 * WHY NOT @nestjs/schedule
 *
 * The API has no scheduler dependency, and adding one for a single job would
 * pull in a cron engine the project does not otherwise need. A `setInterval`
 * owned by a service that clears it in `onModuleDestroy` does the same job with
 * no new dependency, and — importantly — it stops when the module stops, so a
 * graceful shutdown (or a test tearing the app down) cannot leave a timer
 * running against a closed database connection.
 *
 * WHY THE FIRST RUN IS DELAYED
 *
 * Sweeping immediately at boot would race the migrations and the connection
 * pool during startup, and would delete anything uploaded in the moments before
 * a restart. Waiting one full interval means the sweep only ever sees rows that
 * are already far older than the TTL.
 *
 * Failures are logged and swallowed: a sweep is housekeeping, and a database
 * hiccup must not take the process down.
 */
@Injectable()
export class EvidenceSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvidenceSweepService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly evidence: EvidenceService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    /**
     * Run at most as often as the TTL: a more frequent sweep cannot find
     * anything new, because nothing becomes old enough between two runs.
     */
    const intervalMs = EVIDENCE_ORPHAN_TTL_MS;
    this.timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    // Do not hold the process open just for this timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One sweep, exposed so it can be triggered manually (tests, ops). */
  async sweep(): Promise<number> {
    try {
      const removed = await this.evidence.sweepOrphans();
      if (removed > 0) {
        this.logger.log(`Removed ${removed} unbound evidence upload(s)`);
      }
      return removed;
    } catch (err) {
      // Housekeeping must never crash the API.
      this.logger.warn(`Evidence sweep failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
