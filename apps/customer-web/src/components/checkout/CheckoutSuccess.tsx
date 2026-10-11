"use client";

/**
 * Order success.
 *
 * Confirms the order code and the COD state honestly: a COD order is created as
 * PENDING, so "Đã thanh toán" is never shown here.
 */

import { Button, Card, Container, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconCircleCheck, IconShoppingBag } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatMoney } from "@/lib/format";
import { paymentStatusMeta } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { DetailSkeleton, ErrorState } from "@/components/common/States";

export function CheckoutSuccess({ orderId }: { orderId: number }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.orders.detail(orderId),
    queryFn: () => resources.getMyOrder(orderId),
  });

  if (isLoading) {
    return (
      <Container size="sm" py="xl">
        <DetailSkeleton />
      </Container>
    );
  }

  if (isError) {
    return (
      <Container size="sm" py="xl">
        <ErrorState error={error} onRetry={() => refetch()} />
      </Container>
    );
  }

  const order = data;
  if (!order) return null;

  const payment = order.payments[0];

  return (
    <Container size="sm" px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 56 }}>
      <Card padding="xl" radius="md" withBorder>
        <Stack gap="lg" align="center">
          <ThemeIcon size={64} radius="xl" variant="light" color="agri">
            <IconCircleCheck size={34} />
          </ThemeIcon>

          <Stack gap={4} align="center">
            <Title order={2} ta="center">
              Đặt hàng thành công
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Cảm ơn bạn đã mua nông sản trên AgriMarket.
            </Text>
          </Stack>

          <Card padding="md" radius="md" withBorder w="100%">
            <Stack gap="xs">
              <Group justify="space-between" wrap="wrap">
                <Text size="sm" c="dimmed">
                  Mã đơn hàng
                </Text>
                <Text size="sm" fw={700}>
                  {order.code}
                </Text>
              </Group>
              <Group justify="space-between" wrap="wrap">
                <Text size="sm" c="dimmed">
                  Tổng tiền
                </Text>
                <Text size="sm" fw={700} c="agri.9">
                  {formatMoney(order.grandTotal)}
                </Text>
              </Group>
              {payment ? (
                <Group justify="space-between" wrap="wrap">
                  <Text size="sm" c="dimmed">
                    Thanh toán
                  </Text>
                  <StatusBadge
                    label={paymentStatusMeta(payment.status).label}
                    tone={paymentStatusMeta(payment.status).tone}
                  />
                </Group>
              ) : null}
              <Group justify="space-between" wrap="wrap">
                <Text size="sm" c="dimmed">
                  Số kiện hàng
                </Text>
                <Text size="sm">
                  {order.partnerOrders.length} kiện từ {order.partnerOrders.length} đối tác
                </Text>
              </Group>
            </Stack>
          </Card>

          <Text size="xs" c="dimmed" ta="center">
            Đơn hàng COD được thanh toán khi bạn nhận hàng. Trạng thái thanh toán sẽ cập
            nhật sau khi giao thành công.
          </Text>

          <Group grow w="100%" gap="sm">
            <Button
              component={Link}
              href={`/don-hang/${order.id}`}
              leftSection={<IconShoppingBag size={18} />}
            >
              Xem đơn hàng
            </Button>
            <Button component={Link} href="/san-pham" variant="default">
              Tiếp tục mua sắm
            </Button>
          </Group>
        </Stack>
      </Card>
    </Container>
  );
}
