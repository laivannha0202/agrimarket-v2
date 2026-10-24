-- P0-B/C/D: shipment cancellation, quarantine lifecycle, explicit refunds and
-- settlement reconciliation.
--
-- The migration is additive at the row level: existing shipments/refunds/
-- movements keep their values, the new enum members are appended, and the two
-- new tables start empty. No historical row is rewritten.

-- 1. Shipment lifecycle: CANCELLED before handover.
ALTER TABLE `shipments`
  MODIFY `status` ENUM('PENDING','READY','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','RETURNED','CANCELLED')
  NOT NULL DEFAULT 'PENDING';

ALTER TABLE `shipment_events`
  MODIFY `status` ENUM('PENDING','READY','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','RETURNED','CANCELLED')
  NOT NULL;

-- 2. Refund approval step and proof fields.
ALTER TABLE `refunds`
  MODIFY `status` ENUM('PENDING','APPROVED','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `reference` VARCHAR(191) NULL,
  ADD COLUMN `failure_reason` TEXT NULL,
  ADD COLUMN `approved_at` DATETIME(3) NULL;

CREATE INDEX `refunds_status_idx` ON `refunds`(`status`);

-- 3. Quarantine movements.
ALTER TABLE `inventory_movements`
  MODIFY `type` ENUM('INBOUND','OUTBOUND','ADJUSTMENT','RESERVE','RELEASE','RETURN','QUARANTINE','QUARANTINE_RELEASE','SCRAP')
  NOT NULL;

-- 4. A refund closes at most one return request.
ALTER TABLE `return_requests`
  ADD COLUMN `received_at` DATETIME(3) NULL;

CREATE UNIQUE INDEX `return_requests_refund_id_key` ON `return_requests`(`refund_id`);

CREATE INDEX `return_requests_status_idx` ON `return_requests`(`status`);

-- 5. Quarantine cases.
CREATE TABLE `quarantine_cases` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(191) NOT NULL,
  `warehouse_id` INTEGER NOT NULL,
  `product_lot_id` INTEGER NOT NULL,
  `product_variant_id` INTEGER NOT NULL,
  `quantity` DECIMAL(18, 3) NOT NULL,
  `status` ENUM('PENDING','PASSED','FAILED','RELEASED','SCRAPPED') NOT NULL DEFAULT 'PENDING',
  `source_type` VARCHAR(32) NOT NULL,
  `source_id` INTEGER NULL,
  `order_id` INTEGER NULL,
  `return_request_id` INTEGER NULL,
  `reason` TEXT NULL,
  `inspection_note` TEXT NULL,
  `resolution_note` TEXT NULL,
  `stock_added_to_balance` BOOLEAN NOT NULL DEFAULT false,
  `created_by_user_id` INTEGER NULL,
  `resolved_by_user_id` INTEGER NULL,
  `inspected_at` DATETIME(3) NULL,
  `resolved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `quarantine_cases_code_key`(`code`),
  INDEX `quarantine_cases_status_idx`(`status`),
  INDEX `quarantine_cases_order_id_idx`(`order_id`),
  INDEX `quarantine_cases_return_request_id_idx`(`return_request_id`),
  INDEX `quarantine_cases_product_lot_id_idx`(`product_lot_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `quarantine_cases`
  ADD CONSTRAINT `quarantine_cases_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `quarantine_cases_product_lot_id_fkey` FOREIGN KEY (`product_lot_id`) REFERENCES `product_lots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `quarantine_cases_product_variant_id_fkey` FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `quarantine_cases_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `quarantine_cases_return_request_id_fkey` FOREIGN KEY (`return_request_id`) REFERENCES `return_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Settlement reconciliation adjustments (never rewrite historical rows).
CREATE TABLE `settlement_adjustments` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `partner_id` INTEGER NOT NULL,
  `settlement_id` INTEGER NULL,
  `partner_order_id` INTEGER NULL,
  `refund_id` INTEGER NULL,
  `amount` DECIMAL(18, 2) NOT NULL,
  `type` ENUM('REFUND_AFTER_SETTLEMENT') NOT NULL DEFAULT 'REFUND_AFTER_SETTLEMENT',
  `status` ENUM('OPEN','REVIEWED') NOT NULL DEFAULT 'OPEN',
  `resolution` ENUM('DEDUCT_NEXT','WRITE_OFF','MANUAL') NULL,
  `reason` TEXT NOT NULL,
  `resolution_note` TEXT NULL,
  `created_by_user_id` INTEGER NULL,
  `reviewed_by_user_id` INTEGER NULL,
  `reviewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `settlement_adjustments_refund_id_partner_order_id_key`(`refund_id`, `partner_order_id`),
  INDEX `settlement_adjustments_status_idx`(`status`),
  INDEX `settlement_adjustments_settlement_id_idx`(`settlement_id`),
  INDEX `settlement_adjustments_partner_id_idx`(`partner_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `settlement_adjustments`
  ADD CONSTRAINT `settlement_adjustments_partner_id_fkey` FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `settlement_adjustments_settlement_id_fkey` FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `settlement_adjustments_partner_order_id_fkey` FOREIGN KEY (`partner_order_id`) REFERENCES `partner_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `settlement_adjustments_refund_id_fkey` FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
