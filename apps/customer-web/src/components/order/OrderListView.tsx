"use client";

/**
 * Order history.
 *
 * Status tabs map 1:1 to the backend `OrderStatus` enum — no invented states.
 *
 * `GET /orders/me` filters by `status` in SQL and paginates on the server, so
 * each tab shows that tab's own `meta.total` and page count. Nothing is filtered
 * on the client: the page you see is the page the server returned.
 *
 * Order cards always render the order's own snapshot fields
 * (`productNameSnapshot`, `unitPriceSnapshot`) — never the current product
 * price.
 */

import {
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Pagination,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { IconPackage } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { orderStatusMeta, paymentMethodLabel, paymentStatusMeta } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/States";
import { layout } from "@/theme";
import type { Order, OrderStatus } from "@/lib/api/types";

const PAGE_SIZE = 10;

/** `status: null` means "every status" — the backend then skips the filter. */
const TABS: Array<{ value: string; label: string; status: OrderStatus | null }> = [
  { value: "all", label: "Tất cả", status: null },
  { value: "pending", label: "Chờ xác nhận", status: "PENDING_CONFIRMATION" },
  { value: "confirmed", label: "Đã xác nhận", status: "CONFIRMED" },
  { value: "preparing", label: "Đang chuẩn bị", status: "PREPARING" },
  { value: "ready", label: "Chờ giao", status: "READY_TO_SHIP" },
  { value: "shipping", label: "Đang giao", status: "SHIPPING" },
  { value: "delivered", label: "Đã giao", status: "DELIVERED" },
  { value: "cancelled", label: "Đã hủy", status: "CANCELLED" },
];

function OrderCard({ order }: { order: Order }) {
  const items = order.partnerOrders.flatMap((partnerOrder) => partnerOrder.items);
  const itemCount = items.length;
  const payment = order.payments[0];
  const statusMeta = orderStatusMeta(order.status);

  return (
    <Card
      component={Link}
      href={`/don-hang/${order.id}`}
      padding="md"
      radius="md"
      withBorder
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="sm" wrap="wrap">
            <Text size="sm" fw={700}>
              {order.code}
            </Text>
            <Text size="xs" c="dimmed">
              {formatDate(order.createdAt)}
            </Text>
          </Group>
          <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
        </Group>

        <Divider />

        <Stack gap={4}>
          {items.slice(0, 3).map((item) => (
            <Group key={item.id} justify="space-between" wrap="nowrap" gap="sm">
              <Text size="sm" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
                {item.productNameSnapshot} × {formatQuantity(item.quantity)}
              </Text>
              <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                {formatMoney(item.subtotal)}
              </Text>
            </Group>
          ))}
          {itemCount > 3 ? (
            <Text size="xs" c="dimmed">
              và {itemCount - 3} sản phẩm khác
            </Text>
          ) : null}
        </Stack>

        <Divider />

        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap">
            {order.partnerOrders.length > 1 ? (
              <Badge variant="light" color="blue" size="sm" radius="sm">
                {order.partnerOrders.length} kiện từ {order.partnerOrders.length} đối tác
              </Badge>
            ) : null}
            {payment ? (
              <>
                <Badge variant="light" color="gray" size="sm" radius="sm">
                  {paymentMethodLabel(payment.method)}
                </Badge>
                <StatusBadge
                  label={paymentStatusMeta(payment.status).label}
                  tone={paymentStatusMeta(payment.status).tone}
                  size="xs"
                />
              </>
            ) : null}
          </Group>
          <Group gap="xs" align="baseline">
            <Text size="xs" c="dimmed">
              Tổng tiền
            </Text>
            <Text size="sm" fw={700} c="agri.9">
              {formatMoney(order.grandTotal)}
            </Text>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}

export function OrderListView() {
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);

  const tab = TABS.find((t) => t.value === activeTab) ?? TABS[0];
  const status = tab.status ?? undefined;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.orders.list({ page, limit: PAGE_SIZE, status }),
    queryFn: () => resources.listMyOrders({ page, limit: PAGE_SIZE, status }),
  });

  const orders = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text size="sm">Đơn hàng</Text>
        </Breadcrumbs>

        <Stack gap={4}>
          <Title order={2}>Đơn hàng của tôi</Title>
          <Text size="sm" c="dimmed">
            Theo dõi trạng thái đơn hàng, xem nguồn gốc lô hàng và yêu cầu trả hàng.
          </Text>
        </Stack>

        <Tabs
          value={activeTab}
          onChange={(value) => {
            setActiveTab(value ?? "all");
            setPage(1);
          }}
          variant="outline"
        >
          <Tabs.List>
            {TABS.map((item) => (
              <Tabs.Tab key={item.value} value={item.value}>
                {item.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={4} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<IconPackage size={28} />}
            title={
              status
                ? "Không có đơn hàng ở trạng thái này"
                : "Bạn chưa có đơn hàng"
            }
            description={
              status
                ? "Chọn tab khác để xem các đơn hàng khác."
                : "Các đơn hàng bạn đặt sẽ xuất hiện tại đây."
            }
            action={
              status ? undefined : (
                <Button component={Link} href="/san-pham">
                  Mua nông sản
                </Button>
              )
            }
          />
        ) : (
          <Stack gap="md">
            <Stack gap="sm">
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </Stack>

            {totalPages > 1 ? (
              <Box>
                <Group justify="center">
                  <Pagination
                    total={totalPages}
                    value={page}
                    onChange={(value) => {
                      setPage(value);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                </Group>
                <Text size="xs" c="dimmed" ta="center" mt="xs">
                  Trang {page}/{totalPages} · {total} đơn hàng
                </Text>
              </Box>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
