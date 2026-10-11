-- Hưng Yên 2025 commune catalogue + customer account self-service.
--
-- WHY
--   1. The 2025 reorganisation removed the district level and replaced every
--      commune in Hưng Yên with one of 104 new xã/phường (Nghị quyết
--      1666/NQ-UBTVQH15; codes per Quyết định 19/2025/QĐ-TTg, effective
--      2025-07-01). The storefront needs to offer those units as a picker
--      instead of making the customer type a commune name by hand.
--   2. Customers can now register, change their password and recover it, which
--      needs a single-use reset token store.
--
-- SAFETY
--   ADDITIVE ONLY. No column is dropped, no row is rewritten, no value is
--   backfilled. In particular `addresses.district` is KEPT: it holds the
--   historical text of addresses saved before the reorganisation, and guessing
--   a new ward for them would silently falsify customer data. Legacy addresses
--   keep `province_code` / `ward_code` / `ward_name` as NULL and continue to
--   display exactly what they stored.

-- --------------------------------------------------------------------------
-- 1. Province catalogue (two-level model: tỉnh → xã/phường)
-- --------------------------------------------------------------------------

CREATE TABLE `provinces` (
  `code`       VARCHAR(20)  NOT NULL,
  `name`       VARCHAR(120) NOT NULL,
  `full_name`  VARCHAR(160) NOT NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- 2. Commune catalogue (xã / phường)
-- --------------------------------------------------------------------------

CREATE TABLE `wards` (
  -- 5 characters, STRING. Administrative codes have significant leading zeros
  -- and are identifiers, not quantities — an INT column would corrupt them.
  `code`           VARCHAR(5)   NOT NULL,
  `province_code`  VARCHAR(20)  NOT NULL,
  -- 'xa' | 'phuong'
  `type`           VARCHAR(10)  NOT NULL,
  -- Official name without the prefix, e.g. 'Phố Hiến'.
  `name`           VARCHAR(120) NOT NULL,
  -- Official name with the prefix, e.g. 'Phường Phố Hiến'.
  `full_name`      VARCHAR(160) NOT NULL,
  -- Accent-stripped lower-cased haystack, e.g. 'phuong pho hien'.
  `search_text`    VARCHAR(200) NOT NULL,
  `effective_from` VARCHAR(10)  NULL,
  `status`         ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`code`),
  INDEX `wards_province_code_idx` (`province_code`),
  INDEX `wards_status_idx` (`status`),
  CONSTRAINT `wards_province_code_fkey`
    FOREIGN KEY (`province_code`) REFERENCES `provinces` (`code`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- 3. Addresses: verified commune columns (additive, nullable)
-- --------------------------------------------------------------------------
--
-- Existing rows keep NULL in all three columns, so nothing about a legacy
-- address changes: `province` / `district` / `ward` still hold its original
-- text and it still renders exactly as saved.

ALTER TABLE `addresses`
  ADD COLUMN `province_code` VARCHAR(20)  NULL,
  ADD COLUMN `ward_code`     VARCHAR(5)   NULL,
  ADD COLUMN `ward_name`     VARCHAR(120) NULL;

CREATE INDEX `addresses_ward_code_idx` ON `addresses` (`ward_code`);

-- --------------------------------------------------------------------------
-- 4. Password reset tokens
-- --------------------------------------------------------------------------
--
-- `token_hash` stores SHA-256 of the raw token; the raw value only ever exists
-- in the recovery e-mail. A unique index means a duplicate token cannot be
-- inserted, and `used_at` enforces single use.

CREATE TABLE `password_reset_tokens` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `user_id`    INT          NOT NULL,
  `token_hash` VARCHAR(64)  NOT NULL,
  `expires_at` DATETIME(3)  NOT NULL,
  `used_at`    DATETIME(3)  NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `password_reset_tokens_token_hash_key` (`token_hash`),
  INDEX `password_reset_tokens_user_id_idx` (`user_id`),
  INDEX `password_reset_tokens_expires_at_idx` (`expires_at`),
  CONSTRAINT `password_reset_tokens_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

