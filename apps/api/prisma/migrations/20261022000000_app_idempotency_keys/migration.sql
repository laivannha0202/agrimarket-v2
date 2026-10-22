-- DB-backed idempotency ledger for admin/finance state-changing endpoints.
--
-- WHY: POST /inventory/adjust, POST /payouts and POST /refunds had no retry
-- identity. A client retry after a lost response applied the same business
-- write twice (measured: +10 stock / 2 movements for one +5 adjust, 2 payout
-- rows / 60,000 for one 30,000 payout, 2 refund rows / 40,000 for one 20,000
-- refund).
--
-- HOW: a request claims (scope, actor_user_id, key) with a UNIQUE INSERT inside
-- the SAME transaction that writes the business rows, and stores the response
-- body before the commit. A retry either replays the stored body or gets a 409
-- when the payload hash differs; a failed business write rolls the claim back
-- with it, so no request can leave a stuck PENDING key behind.
--
-- `scope` keeps the key endpoint-specific; `actor_user_id` keeps it
-- actor-scoped. `expires_at` implements the retention policy (30 days by
-- default) and expired keys may be reused.
--
-- Additive, no existing table/column is rewritten. This migration itself is
-- NOT re-runnable: `CREATE TABLE` fails if the table already exists. The
-- migration ledger records it once, like every other migration in this repo.

CREATE TABLE `app_idempotency_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scope` VARCHAR(64) NOT NULL,
    `actor_user_id` INTEGER NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `request_hash` VARCHAR(64) NOT NULL,
    `response_status` INTEGER NULL,
    `response_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `app_idempotency_keys_scope_actor_user_id_key_key`(`scope`, `actor_user_id`, `key`),
    INDEX `app_idempotency_keys_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `app_idempotency_keys` ADD CONSTRAINT `app_idempotency_keys_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
