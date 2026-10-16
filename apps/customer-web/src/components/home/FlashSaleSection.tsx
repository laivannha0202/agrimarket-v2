"use client";

/**
 * Current flash sale (home page).
 *
 * Everything rendered comes from `GET /flash-sales`: name, flash price, quota,
 * sold quantity and end time. The countdown only runs when the backend actually
 * returns an `endsAt`, and remaining capacity is never invented — it is
 * `quota - soldQuantity` as reported by the API.
 *
 * "Now" comes from the shared clock store (`useNow`), never from `Date.now()`
 * during render, so a render is a pure function of its inputs.
 * `useActiveFlashSales` is exported so the homepage can learn which products the
 * flash-sale block displays and keep the sections below it free of duplicates.
 */

import { Box, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { IconBolt } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  flashSaleRemainingTotal,
  isFlashItemSoldOut,
  isFlashSaleLive,
} from "@agrimarket/shared-domain/home";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { discountPercent, formatDate, formatMoney, formatRemaining, variantSpecLabel } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { ProductImage } from "@/components/common/ProductImage";
import { AppCard, GhostButton } from "@/components/ui/kit";
import { primaryImageUrl, useCartProducts } from "@/lib/hooks/useCartProducts";
import type { FlashSale } from "@/lib/api/types";

/** Red countdown pill, like the Mobile flash-sale header. */
function CountdownPill({ endsAt, now }: { endsAt: string; now: number }) {
  const text = now === 0 ? null : formatRemaining(endsAt, now);

  return (
    <Box
      component="span"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "var(--agri-danger)",
        color: "#ffffff",
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: "18px",
        flexShrink: 0,
      }}
    >
      <IconBolt size={13} />
      {text ? `Kết thúc sau ${text}` : "Đang diễn ra"}
    </Box>
  );
}

/**
 * The flash sales that are running right now, with real items.
 *
 * Shared by the homepage section and by the page that needs to know which
 * products are already on display above the fold.
 */
export function useActiveFlashSales(): { sales: FlashSale[]; now: number } {
  const now = useNow();

  const { data } = useQuery({
    queryKey: queryKeys.flashSales.list(10),
    queryFn: () => resources.listFlashSales(10),
    staleTime: 30_000,
  });

  // Only sales that are actually running right now. The rule lives in
  // `@agrimarket/shared-domain` so the Mobile home tab selects the exact same
  // sales; until the clock is known (server render) the window check is skipped
  // there and the ACTIVE status decides.
  const sales = (data?.data ?? []).filter((sale) => isFlashSaleLive(sale, now));

  return { sales, now };
}

export function FlashSaleSection() {
  const { sales: active, now } = useActiveFlashSales();

  /**
   * Flash-sale items embed only `productVariant` ("Túi 1 kg"), so the product
   * name and photo are joined from the real product resource — the same trick
   * the Mobile home strip and the cart use. Without this the card would list an
   * anonymous bag size instead of the product the customer is buying.
   */
  const productsById = useCartProducts(
    active.flatMap((sale) => sale.items.map((item) => item.productVariant.productId)),
  );

  if (active.length === 0) return null;

  return (
    <Stack gap={8}>
      <Group justify="space-between" align="center" wrap="nowrap" gap="sm" mt={4} mb={0}>
        <Group gap={8} wrap="nowrap" align="center">
          <IconBolt size={20} color="var(--agri-danger)" />
          <Text fz={16} fw={700} c="var(--agri-text-strong)">
            Flash Sale
          </Text>
        </Group>
        {active[0] ? <CountdownPill endsAt={active[0].endsAt} now={now} /> : null}
      </Group>

      {active.map((sale) => {
        const remainingTotal = flashSaleRemainingTotal(sale);

        return (
          <AppCard key={sale.id}>
            <Stack gap={10}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Text fz={14.5} fw={700} truncate>
                  {sale.name}
                </Text>
                <Text fz={12} c="var(--agri-muted)" style={{ flexShrink: 0 }}>
                  {formatDate(sale.startsAt)} — {formatDate(sale.endsAt)}
                </Text>
              </Group>

              <ScrollArea type="never">
                <Group gap={10} wrap="nowrap" align="flex-start">
                  {sale.items.map((item) => {
                    const soldOut = isFlashItemSoldOut(item);
                    const basePrice = Number(item.productVariant.basePrice);
                    const flashPrice = Number(item.flashPrice);
                    const percent = discountPercent(basePrice, flashPrice);
                    const product = productsById.get(item.productVariant.productId);
                    const name = product?.name ?? item.productVariant.name;

                    return (
                      <Box
                        key={item.id}
                        component={Link}
                        href={`/san-pham/${item.productVariant.productId}`}
                        style={{ width: 142, flexShrink: 0 }}
                      >
                        <Box style={{ position: "relative", borderRadius: 8, overflow: "hidden" }}>
                          <ProductImage
                            src={primaryImageUrl(product)}
                            alt={name}
                            ratio={1}
                            radius={8}
                            sizes="142px"
                          />
                          {percent !== null && percent > 0 ? (
                            <Box
                              component="span"
                              style={{
                                position: "absolute",
                                top: 6,
                                left: 6,
                                background: "var(--agri-danger)",
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 700,
                                borderRadius: 999,
                                padding: "2px 7px",
                                lineHeight: "15px",
                              }}
                            >
                              -{percent}%
                            </Box>
                          ) : null}
                          {soldOut ? (
                            <Box
                              style={{
                                position: "absolute",
                                inset: 0,
                                background: "rgba(15, 18, 15, 0.45)",
                                display: "grid",
                                placeItems: "center",
                              }}
                            >
                              <Text fz={12} fw={700} c="white">
                                Hết suất
                              </Text>
                            </Box>
                          ) : null}
                        </Box>

                        <Text fz={13} fw={600} mt={6} lineClamp={2} lh="18px" h={36}>
                          {name}
                        </Text>
                        <Text fz={12} c="var(--agri-muted)" lineClamp={1}>
                          {variantSpecLabel(item.productVariant)}
                        </Text>
                        <Group gap={6} align="baseline" wrap="nowrap" mt={2}>
                          <Text fz={14} fw={700} c="red.7" style={{ whiteSpace: "nowrap" }}>
                            {formatMoney(flashPrice)}
                          </Text>
                          {flashPrice < basePrice ? (
                            <Text fz={11.5} c="var(--agri-muted)" td="line-through" style={{ whiteSpace: "nowrap" }}>
                              {formatMoney(basePrice)}
                            </Text>
                          ) : null}
                        </Group>
                      </Box>
                    );
                  })}
                </Group>
              </ScrollArea>

              <Group justify="space-between" align="center" wrap="nowrap" gap="sm">
                <Text fz={12.5} c="var(--agri-muted)">
                  {remainingTotal > 0 ? `${remainingTotal} suất còn lại` : "Đã hết suất ưu đãi"}
                </Text>
                <GhostButton component={Link} href="/san-pham" size="compact-sm" radius={8}>
                  Xem ưu đãi
                </GhostButton>
              </Group>
            </Stack>
          </AppCard>
        );
      })}
    </Stack>
  );
}

export { SectionHeader } from "@/components/ui/kit";
