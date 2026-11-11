-- Keep historical business status, farm links and transactions untouched.
-- Historical records have no verified profile, so verification starts PENDING.
-- Their type remains UNSPECIFIED until an administrator reviews their profile.
ALTER TABLE `partners`
  MODIFY COLUMN `representative_name` VARCHAR(191) NULL,
  MODIFY COLUMN `email` VARCHAR(191) NULL,
  MODIFY COLUMN `address` VARCHAR(191) NULL,
  ADD COLUMN `type` ENUM('UNSPECIFIED','COOPERATIVE','COMPANY','HOUSEHOLD','INDIVIDUAL') NOT NULL DEFAULT 'UNSPECIFIED',
  ADD COLUMN `registration_document_url` VARCHAR(1000) NULL,
  ADD COLUMN `verification_status` ENUM('PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING';

CREATE INDEX `partners_type_idx` ON `partners`(`type`);
CREATE INDEX `partners_verification_status_idx` ON `partners`(`verification_status`);

-- Preflight: phone, non-NULL email and non-NULL tax_code must each be unique.
-- MariaDB permits multiple NULLs in a unique index for optional fields.
DROP INDEX `partners_phone_idx` ON `partners`;
CREATE UNIQUE INDEX `partners_phone_key` ON `partners`(`phone`);
CREATE UNIQUE INDEX `partners_email_key` ON `partners`(`email`);
CREATE UNIQUE INDEX `partners_tax_code_key` ON `partners`(`tax_code`);
