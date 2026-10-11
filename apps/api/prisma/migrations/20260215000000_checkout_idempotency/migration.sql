-- Checkout idempotency keys.
--
-- WHY: `POST /orders/checkout` had no way to recognise a retried request. A
-- customer whose response was lost (network drop, timeout, double tap) could
-- create the same order twice, reserving stock twice.
--
-- HOW: the client sends an `idempotencyKey` header/field. The backend stores
-- (customer_id, key) with the hash of the checkout payload it was first used
-- with:
--   * same key + same payload  -> the already-created order is returned
--     (no second order, no second reservation);
--   * same key + different payload -> rejected with a clear 409;
--   * no key -> the request behaves exactly as before (optional field), so
--     existing clients and tests keep working.
--
-- The row is inserted inside the checkout transaction, so a failed checkout
-- (e.g. insufficient stock) leaves no key behind and a later retry can succeed.

-- CreateTable
CREATE TABLE `checkout_idempotency_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer_id` INTEGER NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `request_hash` VARCHAR(191) NOT NULL,
    `order_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `checkout_idempotency_keys_customer_id_key_key`(`customer_id`, `key`),
    INDEX `checkout_idempotency_keys_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `checkout_idempotency_keys` ADD CONSTRAINT `checkout_idempotency_keys_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkout_idempotency_keys` ADD CONSTRAINT `checkout_idempotency_keys_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
