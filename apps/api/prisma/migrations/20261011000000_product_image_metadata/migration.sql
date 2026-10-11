-- Product image metadata for the Admin upload flow.
--
-- WHY: uploaded files are optimised (resized/re-encoded) before storage, so
-- the row keeps the real content type, dimensions and byte size alongside the
-- stable public URL. Admin and support can verify what was stored without
-- opening the file.
--
-- Additive only: four nullable columns. Existing rows keep NULL (their files
-- predate the upload flow), so no data is rewritten.

ALTER TABLE `product_images`
  ADD COLUMN `mime_type` VARCHAR(64) NULL,
  ADD COLUMN `width` INT NULL,
  ADD COLUMN `height` INT NULL,
  ADD COLUMN `size_bytes` INT NULL;
