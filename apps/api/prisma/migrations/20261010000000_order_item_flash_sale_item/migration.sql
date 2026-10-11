-- Attribute a flash-sale purchase to the exact FlashSaleItem that priced it.
--
-- WHY: `consumeFlashSaleQuota` used to re-resolve the flash item from the
-- variant alone (and the per-customer limit counted any `order_items` row whose
-- snapshot price equalled the flash price inside the sale window). Two problems
-- followed:
--   * `resolvePrice` picked the *cheapest* active item (`flashPrice asc`) while
--     `consumeFlashSaleQuota` picked the *oldest* (`id asc`), so with overlapping
--     sales the price charged and the quota drawn could come from two different
--     programs;
--   * the per-customer limit relied on "same price => same program", which
--     conflates two sales that share a price (or a normal purchase at that price).
--
-- HOW: `order_items` now snapshots the `flash_sale_item_id` the line was actually
-- priced at (NULL for a non-flash line). Quota is consumed from, and the
-- per-customer limit counted against, that id — never a price match.
--
-- Additive only: one nullable column + one index + one FK. Existing rows keep
-- NULL (their flash attribution is unknown), so no data is rewritten.

-- AlterTable
ALTER TABLE `order_items` ADD COLUMN `flash_sale_item_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `order_items_flash_sale_item_id_idx` ON `order_items`(`flash_sale_item_id`);

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_flash_sale_item_id_fkey` FOREIGN KEY (`flash_sale_item_id`) REFERENCES `flash_sale_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
