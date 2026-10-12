"use client";

/**
 * Current flash sale.
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

import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconBolt } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate, formatMoney, formatRemaining, variantSpecLabel } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { ProductImage } from "@/components/common/ProductImage";
import { primaryImageUrl, useCartProducts } from "@/lib/hooks/useCartProducts";
import type { FlashSale } from "@/lib/api/types";

function Countdown({ endsAt, now }: { endsAt: string; now: number }) {
  if (now === 0) {
    // Server / hydration render: the clock is not known yet.
    return (
      <Badge color="red" variant="light" size="lg" radius="sm">
        Đang diễn ra
      </Badge>
    );
  }

  const text = formatRemaining(endsAt, now);
  if (!text) return null;

  return (
    <Badge color="red" variant="filled" size="lg" radius="sm">
      Kết thúc sau {text}
    </Badge>
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

  // Only sales that are actually running right now. Until the clock is known
  // (server render) the window check is skipped and the ACTIVE status decides.
  const sales = (data?.data ?? []).filter((sale) => {
    if (sale.status !== "ACTIVE") return false;
    if ((sale.items?.length ?? 0) === 0) return false;
    if (now === 0) return true;
    return new Date(sale.startsAt).getTime() <= now && new Date(sale.endsAt).getTime() >= now;
  });

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
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="sm">
          <IconBolt size={24} color="var(--mantine-color-red-6)" />
          <Title order={3}>Flash Sale</Title>
        </Group>
        {active[0] ? <Countdown endsAt={active[0].endsAt} now={now} /> : null}
      </Group>

      {active.map((sale) => (
        <Card key={sale.id} padding="md" radius="md" withBorder>
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Text fw={700}>{sale.name}</Text>
              <Text size="xs" c="dimmed">
                {formatDate(sale.startsAt)} — {formatDate(sale.endsAt)}
              </Text>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
              {sale.items.map((item) => {
                const remaining = Math.max(0, item.quota - item.soldQuantity);
                const soldPercent =
                  item.quota > 0 ? Math.min(100, (item.soldQuantity / item.quota) * 100) : 0;
                const basePrice = Number(item.productVariant.basePrice);
                const flashPrice = Number(item.flashPrice);
                const product = productsById.get(item.productVariant.productId);

                return (
                  <Card
                    key={item.id}
                    component={Link}
                    href={`/san-pham/${item.productVariant.productId}`}
                    padding="sm"
                    radius="md"
                    withBorder
                  >
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <Box w={64} style={{ flexShrink: 0 }}>
                        <ProductImage
                          src={primaryImageUrl(product)}
                          alt={product?.name ?? item.productVariant.name}
                          ratio={1}
                          fallbackLabel={product?.name ?? item.productVariant.name}
                          sizes="64px"
                        />
                      </Box>
                      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={600} className="agri-clamp-2">
                          {product?.name ?? item.productVariant.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {variantSpecLabel(item.productVariant)}
                        </Text>
                        <Group gap={8} align="baseline">
                          <Text fw={700} c="red.7">
                            {formatMoney(flashPrice)}
                          </Text>
                          {flashPrice < basePrice ? (
                            <Text size="xs" c="dimmed" td="line-through">
                              {formatMoney(basePrice)}
                            </Text>
                          ) : null}
                        </Group>

                        <Box>
                          <Progress value={soldPercent} size="sm" radius="xl" color="red" />
                          <Group justify="space-between" mt={4}>
                            <Text size="xs" c="dimmed">
                              Đã bán {item.soldQuantity}
                            </Text>
                            <Text size="xs" fw={600} c={remaining > 0 ? "red.7" : "dimmed"}>
                              {remaining > 0 ? `Còn ${remaining}` : "Hết suất"}
                            </Text>
                          </Group>
                        </Box>

                        <Text size="xs" c="dimmed">
                          Tối đa {item.perCustomerLimit} sản phẩm mỗi khách
                        </Text>
                      </Stack>
                    </Group>
                  </Card>
                );
              })}
            </SimpleGrid>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

export function SectionHeader({
  title,
  href,
  linkLabel = "Xem tất cả",
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <Group justify="space-between" align="center" wrap="wrap">
      <Title order={3}>{title}</Title>
      {href ? (
        <Button component={Link} href={href} variant="subtle" size="sm">
          {linkLabel}
        </Button>
      ) : null}
    </Group>
  );
}
