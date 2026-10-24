import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { OrdersService } from './orders.service.js';
import { reservationSweepIntervalMs } from './reservation-policy.js';
import { OrderStatus } from '../../generated/prisma/enums.js';

/**
 * Releases stock held by checkouts that were never confirmed.
 *
 * WHY A JOB IS NEEDED
 *
 * Checkout reserves stock before payment/confirmation. If the customer closes
 * the tab, the reservation would stay on the balance forever, making sellable
 * stock disappear. The order already has a state machine and a safe
 * cancellation path; this service only decides *when* that path may run.
 *
 * WHY NOT @nestjs/schedule
 *
 * Same reasoning as `EvidenceSweepService`: one job does not justify a cron
 * dependency. A `setInterval` owned by the service is cleared in
 * `onModuleDestroy`, so a graceful shutdown (or a test closing the app) cannot
 * leave a timer running against a closed pool.
 *
 * SAFETY
 *
 * The sweep is a filter, not the authority. `OrdersService.expireReservation`
 * re-checks the deadline, the order status, paid payments and shipments, and
 * cancels through the same compare-and-set used by an operator. A race simply
 * produces a skipped row.
 */
@Injectable()
export class OrderReservationExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderReservationExpiryService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    const intervalMs = reservationSweepIntervalMs(
      process.env.ORDER_RESERVATION_TTL_MINUTES,
    );
    this.timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One sweep, exposed for tests and ops. Returns how many reservations were
   * released and how many due rows were skipped (paid, shipped, raced, …).
   */
  async sweep(
    now: Date = new Date(),
    batchSize = 100,
  ): Promise<{ expired: number; skipped: number }> {
    try {
      const due = await this.prisma.order.findMany({
        where: {
          status: OrderStatus.PENDING_CONFIRMATION,
          reservationExpiresAt: { lte: now },
        },
        select: { id: true },
        orderBy: [{ reservationExpiresAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
      });

      let expired = 0;
      let skipped = 0;
      for (const { id } of due) {
        try {
          const result = await this.orders.expireReservation(id, now);
          if (result.expired) expired += 1;
          else skipped += 1;
        } catch (error) {
          // One bad row must not stop the batch; the next tick retries it.
          skipped += 1;
          this.logger.warn(
            `Reservation expiry failed for order ${id}: ${(error as Error).message}`,
          );
        }
      }

      if (expired > 0) {
        this.logger.log(`Expired ${expired} unconfirmed order reservation(s)`);
      }
      return { expired, skipped };
    } catch (error) {
      // Housekeeping must never crash the API.
      this.logger.warn(`Reservation sweep failed: ${(error as Error).message}`);
      return { expired: 0, skipped: 0 };
    }
  }
}
