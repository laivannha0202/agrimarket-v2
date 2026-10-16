"use client";

/**
 * Order history — the web twin of the Mobile orders screen.
 *
 * The status filter is a *server* filter (`GET /orders/me?status=`), so every
 * chip hits the backend and the list never claims to show "all" while hiding
 * rows it already has. That also means the empty state has to distinguish
 * "you have no orders" from "no order matches this status".
 *
 * Paging is "Xem thêm": the first page is the mobile app's own 20 newest
 * orders, and the customer pulls older ones in when they want them — the
 * count line states exactly how many of the total are on screen, and nothing
 * is filtered or reordered on the client.
 *
 * Order cards always render the order's own snapshot fields
 * (`productNameSnapshot`, `unitPriceSnapshot`) — never the current product
 * price.
 */

import { Button, Container, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconBuildingStore, IconClock, IconCube } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, formatMoney } from "@/lib/format";
import { orderStatusMeta } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState, ErrorState } from "@/components/common/States";
import { AppCard, FilterChip, GhostButton, LoadingView, PageTitle } from "@/components/ui/kit";
import { layout } from "@/theme";
import type { Order, OrderStatus } from "@/lib/api/types";

/** Mobile fetches the 20 newest orders; the web keeps the same page size. */
const PAGE_SIZE = 20;

/**
 * The Mobile filter row, verbatim: six chips, `""` meaning "every status".
 * The backend skips the filter when no status is sent.
 */
const FILTERS: Array<{ value: "" | OrderStatus; label: string }> = [
  { value: "", label: "Tất cả" },
  { value: "PENDING_CONFIRMATION", label: orderStatusMeta("PENDING_CONFIRMATION").label },
  { value: "CONFIRMED", label: orderStatusMeta("CONFIRMED").label },
  { value: "SHIPPING", label: orderStatusMeta("SHIPPING").label },
  { value: "DELIVERED", label: orderStatusMeta("DELIVERED").label },
  { value: "CANCELLED", label: orderStatusMeta("CANCELLED").label },
];

function OrderCard({ order }: { order: Order }) {
  const meta = orderStatusMeta(order.status);
  const items = order.partnerOrders.flatMap((partnerOrder) => partnerOrder.items);
  const firstItem = items[0];
  const supplierCount = order.partnerOrders.length;

  return (
    <AppCard component={Link} href={`/don-hang/${order.id}`} className="agri-press">
      <Group justify="space-between" align="center" gap={8} wrap="nowrap">
        <Text fz={14} fw={700} c="var(--agri-text-strong)" truncate style={{ flex: 1 }}>
          {order.code}
        </Text>
        <StatusBadge label={meta.label} tone={meta.tone} />
      </Group>

      <Group gap={5} align="center" mt={6} wrap="nowrap">
        <IconClock size={14} color="var(--agri-muted-soft)" aria-hidden />
        <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
          {formatDateTime(order.createdAt)}
        </Text>
      </Group>

      {/* Real line items only — when the backend returns none we say so
          instead of printing a placeholder count. */}
      {firstItem ? (
        <Group gap={5} align="center" mt={4} wrap="nowrap">
          <IconCube size={14} color="var(--agri-muted-soft)" aria-hidden />
          <Text fz={12.5} lh="18px" c="var(--agri-muted)" truncate style={{ flex: 1 }}>
            {firstItem.productNameSnapshot}
            {items.length > 1 ? ` và ${items.length - 1} sản phẩm khác` : ""}
          </Text>
        </Group>
      ) : null}

      {supplierCount > 0 ? (
        <Group gap={5} align="center" mt={4} wrap="nowrap">
          <IconBuildingStore size={14} color="var(--agri-muted-soft)" aria-hidden />
          <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
            {supplierCount} nhà cung cấp
          </Text>
        </Group>
      ) : null}

      <Group
        justify="space-between"
        align="center"
        gap={8}
        mt={8}
        pt={8}
        style={{ borderTop: "1px solid var(--agri-border)" }}
      >
        <Text fz={13} c="var(--agri-muted)">
          Tổng cộng
        </Text>
        <Text fz={15} fw={700} c="var(--agri-primary)">
          {formatMoney(order.grandTotal)}
        </Text>
      </Group>
    </AppCard>
  );
}

export function OrderListView() {
  const [status, setStatus] = useState<"" | OrderStatus>("");

  const list = useInfiniteQuery({
    queryKey: queryKeys.orders.infinite(status || undefined, PAGE_SIZE),
    queryFn: ({ pageParam }) =>
      resources.listMyOrders({
        page: pageParam,
        limit: PAGE_SIZE,
        status: status || undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
  });

  const orders = list.data?.pages.flatMap((page) => page.data) ?? [];
  const total = list.data?.pages[0]?.meta.total ?? 0;
  const hasFilter = status !== "";

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <PageTitle>Đơn hàng của tôi</PageTitle>

      <Stack gap={12} mt={{ base: 0, md: 12 }}>
        {/* Status chips: the server filter, exactly the Mobile filter row. */}
        <Group gap={8} wrap="wrap">
          {FILTERS.map((filter) => (
            <FilterChip
              key={filter.value || "all"}
              active={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </FilterChip>
          ))}
        </Group>

        {list.isPending ? (
          <LoadingView label="Đang tải đơn hàng…" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : orders.length === 0 ? (
          <EmptyState
            kind="orders"
            title={hasFilter ? "Không có đơn ở trạng thái này" : "Chưa có đơn hàng"}
            description={
              hasFilter
                ? "Bạn không có đơn nào ở trạng thái đã chọn. Chọn trạng thái khác hoặc xem tất cả."
                : "Bạn chưa có đơn hàng nào. Đơn đã đặt sẽ được theo dõi tại đây."
            }
            action={
              hasFilter ? (
                <Button radius={8} onClick={() => setStatus("")}>
                  Xem tất cả
                </Button>
              ) : (
                <Button component={Link} href="/san-pham" radius={8}>
                  Xem sản phẩm
                </Button>
              )
            }
          />
        ) : (
          <Stack gap={8} align="stretch">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={8} verticalSpacing={8}>
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </SimpleGrid>

            {list.hasNextPage ? (
              <GhostButton
                radius={8}
                size="md"
                loading={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
                mx="auto"
                w="fit-content"
                styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 700 } }}
              >
                Xem thêm
              </GhostButton>
            ) : null}

            {orders.length > 0 && total > orders.length ? (
              <Text fz={12} c="var(--agri-muted)" ta="center">
                Hiển thị {orders.length}/{total} đơn hàng gần nhất.
              </Text>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
