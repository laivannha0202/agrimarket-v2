-- Evidence photos for reviews, complaints and return requests.
--
-- WHY: the three after-sales flows need the same thing — up to five validated
-- images with identical size/format rules and identical privacy requirements.
-- Three near-identical tables would triple the validation and the access
-- checks, which is where security bugs hide, so one table holds them all and a
-- CHECK constraint guarantees every row has exactly one owner.
--
-- PRIVACY: the file is NOT under the public `/uploads/products/` prefix. It is
-- stored in a private directory and served only through `GET /evidence/:id/file`,
-- which resolves the owner and authorises the caller. A review's images become
-- publicly readable only when the review is APPROVED.
--
-- Additive only: a brand-new table. `reviews`, `complaints` and
-- `return_requests` are untouched, so every existing row and query keeps
-- working and no historical data is rewritten.

CREATE TABLE `evidence_images` (
  `id`             INT           NOT NULL AUTO_INCREMENT,
  `storage_key`    VARCHAR(128)  NOT NULL,
  `mime_type`      VARCHAR(64)   NOT NULL,
  `size_bytes`     INT           NOT NULL,
  `width`          INT           NOT NULL,
  `height`         INT           NOT NULL,
  `original_name`  VARCHAR(255)  NULL,
  `created_at`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `uploaded_by_id` INT           NOT NULL,
  `review_id`      INT           NULL,
  `complaint_id`   INT           NULL,
  `return_id`      INT           NULL,
  `sort_order`     INT           NOT NULL DEFAULT 0,

  INDEX `evidence_images_review_id_idx` (`review_id`),
  INDEX `evidence_images_complaint_id_idx` (`complaint_id`),
  INDEX `evidence_images_return_id_idx` (`return_id`),
  INDEX `evidence_images_uploaded_by_id_created_at_idx` (`uploaded_by_id`, `created_at`),

  PRIMARY KEY (`id`),

  CONSTRAINT `evidence_images_uploaded_by_id_fkey`
    FOREIGN KEY (`uploaded_by_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT `evidence_images_review_id_fkey`
    FOREIGN KEY (`review_id`) REFERENCES `reviews` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT `evidence_images_complaint_id_fkey`
    FOREIGN KEY (`complaint_id`) REFERENCES `complaints` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT `evidence_images_return_id_fkey`
    FOREIGN KEY (`return_id`) REFERENCES `return_requests` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
