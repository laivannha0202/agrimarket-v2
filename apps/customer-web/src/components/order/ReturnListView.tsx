"use client";

/**
 * Return requests.
 *
 * The customer list is server-side: `GET /returns/me` returns the caller's own
 * requests (filterable by status) with an accurate total, so a request stays
 * visible after a re-login or from another device. A return can only be started
 * from a DELIVERED order, so the entry point is the delivered orders list below.
 */

import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Container,
  Divider,
  Group,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconInfoCircle,
  IconPackageExport,
  IconRotateClockwise,
} from "@tabler/icons-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { returnStatusMeta } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/States";
import { layout } from "@/theme";
import type { ReturnRequestStatus } from "@/lib/api/types";

const FETCH_LIMIT = 100;

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "Tất cả" },
  { value: "REQUESTED", label: "Đã gửi" },
  { value: "APPROVED", label: "Đã chấp nhận" },
  { value: "RETURNING", label: "Đang gửi trả" },
  { value: "RECEIVED", label: "Đã nhận hàng" },
  { value: "QC_PENDING", label: "Chờ kiểm định" },
  { value: "REFUNDED", label: "Đã hoàn tiền" },
  { value: "REJECTED", label: "Từ chối" },
];

function MyReturns() {
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.returns.list({
      page: 1,
      limit: FETCH_LIMIT,
      status: statusFilter === "ALL" ? undefined : (statusFilter as ReturnRequestStatus),
    }),
    queryFn: () =>
      resources.listMyReturns({
        page: 1,
        limit: FETCH_LIMIT,
        status: statusFilter === "ALL" ? undefined : (statusFilter as ReturnRequestStatus),
      }),
  });

  const records = data?.data ?? [];

  return (
    <Stack gap="md">
      <SegmentedControl
        value={statusFilter}
        onChange={setStatusFilter}
        data={STATUS_FILTERS}
        size="xs"
        fullWidth
      />

      {isLoading ? <ListSkeleton rows={2} /> : null}
      {isError ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

      {!isLoading && !isError && records.length === 0 ? (
        <EmptyState
          icon={<IconPackageExport size={28} />}
          title="Chưa có yêu cầu trả hàng nào"
          description="Yêu cầu trả hàng bạn gửi sẽ được lưu trên hệ thống và hiển thị tại đây."
        />
      ) : null}

      {records.map((record) => {
        const meta = returnStatusMeta(record.status);
        return (
          <Card key={record.id} padding="md" radius="md" withBorder>
            <Stack gap="sm">
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Group gap="sm" wrap="wrap">
                  <Text size="sm" fw={700}>
                    Yêu cầu trả hàng #{record.id}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Gửi lúc {formatDateTime(record.createdAt)}
                  </Text>
                </Group>
                <StatusBadge label={meta.label} tone={meta.tone} />
              </Group>
              <Divider />
              {record.order ? (
                <Group justify="space-between" wrap="wrap" gap="xs">
                  <Text size="sm" c="dimmed">
                    Đơn hàng
                  </Text>
                  <Text size="sm" fw={600}>
                    {record.order.code}
                  </Text>
                </Group>
              ) : null}
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Text size="sm" c="dimmed">
                  Số lượng trả
                </Text>
                <Text size="sm">{formatQuantity(record.quantity)}</Text>
              </Group>
              <Stack gap={2}>
                <Text size="sm" c="dimmed">
                  Lý do
                </Text>
                <Text size="sm">{record.reason}</Text>
              </Stack>
              <Group gap="sm" wrap="wrap">
                <Button
                  component={Link}
                  href={`/tra-hang/${record.id}`}
                  variant="light"
                  size="xs"
                  rightSection={<IconArrowRight size={14} />}
                >
                  Xem chi tiết
                </Button>
                <Button
                  component={Link}
                  href={`/don-hang/${record.orderId}`}
                  variant="default"
                  size="xs"
                >
                  Xem đơn hàng liên quan
                </Button>
              </Group>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}

function DeliveredOrdersForReturn() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.orders.list({ page: 1, limit: FETCH_LIMIT }),
    queryFn: () => resources.listMyOrders({ page: 1, limit: FETCH_LIMIT }),
  });

  const delivered = useMemo(
    () => (data?.data ?? []).filter((order) => order.status === "DELIVERED"),
    [data],
  );

  if (isLoading) return <ListSkeleton rows={2} />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  if (delivered.length === 0) {
    return (
      <EmptyState
        icon={<IconRotateClockwise size={28} />}
        title="Chưa có đơn hàng nào đã giao"
        description="Bạn có thể yêu cầu trả hàng sau khi đơn hàng được giao thành công."
        action={
          <Button component={Link} href="/don-hang">
            Xem đơn hàng của tôi
          </Button>
        }
      />
    );
  }

  return (
    <Stack gap="sm">
      {delivered.map((order) => {
        const items = order.partnerOrders.flatMap((partnerOrder) => partnerOrder.items);
        return (
          <Card key={order.id} padding="md" radius="md" withBorder>
            <Stack gap="sm">
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Group gap="sm" wrap="wrap">
                  <Text size="sm" fw={700}>
                    {order.code}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatDateTime(order.createdAt)}
                  </Text>
                </Group>
                <Badge variant="light" color="agri" radius="sm">
                  Đã giao
                </Badge>
              </Group>
              <Divider />
              <Stack gap={4}>
                {items.map((item) => (
                  <Group key={item.id} justify="space-between" wrap="wrap" gap="xs">
                    <Text size="sm" lineClamp={1}>
                      {item.productNameSnapshot} × {formatQuantity(item.quantity)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {formatMoney(item.subtotal)}
                    </Text>
                  </Group>
                ))}
              </Stack>
              <Button
                component={Link}
                href={`/don-hang/${order.id}`}
                variant="light"
                size="xs"
                w="fit-content"
                rightSection={<IconArrowRight size={14} />}
              >
                Chọn sản phẩm cần trả
              </Button>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}

export function ReturnListView() {
  const [tab, setTab] = useState<string>("create");

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text size="sm">Trả hàng</Text>
        </Breadcrumbs>

        <Stack gap={4}>
          <Title order={2}>Trả hàng</Title>
          <Text size="sm" c="dimmed">
            Gửi yêu cầu trả hàng cho sản phẩm trong đơn đã giao. Hàng trả về sẽ được kiểm
            định lại trước khi xử lý hoàn tiền.
          </Text>
        </Stack>

        <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">
            Chỉ đơn hàng đã giao mới được yêu cầu trả hàng. Số lượng trả không vượt quá số
            lượng đã mua và bạn cần nêu rõ lý do.
          </Text>
        </Alert>

        <Tabs value={tab} onChange={(value) => setTab(value ?? "create")} variant="outline">
          <Tabs.List>
            <Tabs.Tab value="create">Tạo yêu cầu trả hàng</Tabs.Tab>
            <Tabs.Tab value="submitted">Yêu cầu của tôi</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="create" pt="md">
            <DeliveredOrdersForReturn />
          </Tabs.Panel>

          <Tabs.Panel value="submitted" pt="md">
            <MyReturns />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
