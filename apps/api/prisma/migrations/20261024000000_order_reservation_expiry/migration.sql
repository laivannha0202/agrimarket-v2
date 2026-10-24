-- Reservation expiry for PENDING_CONFIRMATION orders.
--
-- Additive at the row level: existing orders keep `reservation_expires_at` NULL,
-- which the sweep treats as "no deadline" (never expired). New checkouts write
-- the timestamp; the first status transition clears it.

ALTER TABLE `orders`
  ADD COLUMN `reservation_expires_at` DATETIME(3) NULL;

CREATE INDEX `orders_status_reservation_expires_at_idx`
  ON `orders`(`status`, `reservation_expires_at`);
