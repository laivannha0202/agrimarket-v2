-- C-08: explicit approval workflow for late-refund recovery.
--
-- A DEDUCT_NEXT review of a settlement adjustment now opens a
-- settlement_recoveries row in PENDING_APPROVAL. Nothing is debited
-- automatically: a second human action is required to approve, and the money is
-- only closed when it is either recorded as recovered (with a reference) or
-- rejected. Historical settlements and adjustments are never rewritten.
--
-- Additive at the row level: the table starts empty and no existing enum or
-- column changes.

CREATE TABLE `settlement_recoveries` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `partner_id` INTEGER NOT NULL,
  `adjustment_id` INTEGER NOT NULL,
  `amount` DECIMAL(18, 2) NOT NULL,
  `status` ENUM('PENDING_APPROVAL','APPROVED','RECORDED','REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  `reason` TEXT NOT NULL,
  `requested_by_user_id` INTEGER NULL,
  `decision_note` TEXT NULL,
  `approved_by_user_id` INTEGER NULL,
  `approved_at` DATETIME(3) NULL,
  `rejected_by_user_id` INTEGER NULL,
  `rejected_at` DATETIME(3) NULL,
  `recorded_by_user_id` INTEGER NULL,
  `recorded_at` DATETIME(3) NULL,
  `recovery_reference` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `settlement_recoveries_adjustment_id_key`(`adjustment_id`),
  INDEX `settlement_recoveries_partner_id_status_idx`(`partner_id`, `status`),
  INDEX `settlement_recoveries_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `settlement_recoveries`
  ADD CONSTRAINT `settlement_recoveries_partner_id_fkey` FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `settlement_recoveries_adjustment_id_fkey` FOREIGN KEY (`adjustment_id`) REFERENCES `settlement_adjustments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
