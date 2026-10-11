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
import { formatDate, formatMoney, formatRemaining } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";

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

export function FlashSaleSection() {
  const now = useNow();

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.flashSales.list(10),
    queryFn: () => resources.listFlashSales(10),
    staleTime: 30_000,
  });

  if (isLoading || isError) return null;

  // Only sales that are actually running right now. Until the clock is known
  // (server render) the window check is skipped and the ACTIVE status decides.
  const active = (data?.data ?? []).filter((sale) => {
    if (sale.status !== "ACTIVE") return false;
    if ((sale.items?.length ?? 0) === 0) return false;
    if (now === 0) return true;
    return (
      new Date(sale.startsAt).getTime() <= now && new Date(sale.endsAt).getTime() >= now
    );
  });

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

                return (
                  <Card
                    key={item.id}
                    component={Link}
                    href={`/san-pham/${item.productVariant.productId}`}
                    padding="sm"
                    radius="md"
                    withBorder
                  >
                    <Stack gap={6}>
                      <Text size="sm" fw={600} className="agri-clamp-2">
                        {item.productVariant.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {item.productVariant.sku}
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
