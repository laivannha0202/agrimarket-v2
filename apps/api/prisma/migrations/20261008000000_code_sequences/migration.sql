-- Daily business-code counters.
--
-- WHY: `OrdersService.nextOrderCode` derived the next `ORD-YYYYMMDD-NNNN` from
-- the highest existing order code of the day. Concurrent checkouts all read the
-- same maximum, built the same code, and collided on `orders.orders_code_key`;
-- the retry storm then interleaved with the checkout write set and produced
-- deadlocks (MySQL 1213 / Prisma P2034) and transaction timeouts (P2028)
-- instead of two orders.
--
-- HOW: one counter row per `<PREFIX>-<YYYYMMDD>-`. Allocation is a single
-- `INSERT ... ON DUPLICATE KEY UPDATE value = value + 1` followed by a
-- `SELECT value`, executed inside the checkout transaction: every writer
-- queues on the same row's exclusive lock and leaves with a distinct number —
-- no gap locks, no duplicate-key retries. The counter is taken before any
-- inventory lock, so concurrent checkouts also share one global lock order.

CREATE TABLE `code_sequences` (
    `name` VARCHAR(64) NOT NULL,
    `value` BIGINT NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the counters from the order codes that already exist, so deploying this
-- mid-day continues after the highest code of that day instead of handing out
-- `0001` again and colliding with a committed order.
--
-- The `REGEXP` matches the same codes the old helper parsed: leading digits
-- after the day stamp, with an optional suffix (`ORD-…-0007-P01` counts as 7).
-- `GROUP BY` repeats the full `CONCAT(...)` expression instead of just
-- `SUBSTRING(code, 5, 8)`: under `sql_mode=only_full_group_by` MySQL does not
-- treat the projection as functionally dependent on the bare substring, and the
-- migration fails with error 1055.
INSERT INTO `code_sequences` (`name`, `value`)
SELECT CONCAT('ORD-', SUBSTRING(`code`, 5, 8), '-') AS `name`,
       MAX(CAST(SUBSTRING(`code`, 14) AS UNSIGNED)) AS `value`
  FROM `orders`
 WHERE `code` REGEXP '^ORD-[0-9]{8}-[0-9]'
 GROUP BY CONCAT('ORD-', SUBSTRING(`code`, 5, 8), '-');
