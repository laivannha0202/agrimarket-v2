"use client";

/**
 * Complaints.
 *
 * The customer list is server-side: `GET /complaints/me` returns the caller's
 * own complaints (filterable by status) with an accurate total, so they stay
 * visible after a re-login. A complaint may be filed for any of the customer's
 * own orders (the backend does not restrict it to DELIVERED), with an optional
 * single order item.
 */

import {
  Alert,
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
import { IconArrowRight, IconInfoCircle, IconMessageReport } from "@tabler/icons-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime } from "@/lib/format";
import { complaintStatusMeta, complaintTypeLabel, orderStatusMeta } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/States";
import { ComplaintModal } from "@/components/order/ComplaintModal";
import { layout } from "@/theme";
import type { ComplaintStatus, Order } from "@/lib/api/types";

const FETCH_LIMIT = 100;

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "Tất cả" },
  { value: "OPEN", label: "Đã tiếp nhận" },
  { value: "PROCESSING", label: "Đang xử lý" },
  { value: "RESOLVED", label: "Đã giải quyết" },
  { value: "REJECTED", label: "Từ chối" },
];

function MyComplaints() {
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.complaints.list({
      page: 1,
      limit: FETCH_LIMIT,
      status: statusFilter === "ALL" ? undefined : (statusFilter as ComplaintStatus),
    }),
    queryFn: () =>
      resources.listMyComplaints({
        page: 1,
        limit: FETCH_LIMIT,
        status: statusFilter === "ALL" ? undefined : (statusFilter as ComplaintStatus),
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

      {isLoading ? <ListSkeleton rows={3} /> : null}
      {isError ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

      {!isLoading && !isError && records.length === 0 ? (
        <EmptyState
          icon={<IconMessageReport size={28} />}
          title="Chưa có khiếu nại nào"
          description="Khiếu nại bạn gửi sẽ được lưu trên hệ thống và hiển thị tại đây."
        />
      ) : null}

      {records.map((record) => {
        const meta = complaintStatusMeta(record.status);
        return (
          <Card key={record.id} padding="md" radius="md" withBorder>
            <Stack gap="sm">
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Group gap="sm" wrap="wrap">
                  <Text size="sm" fw={700}>
                    {complaintTypeLabel(record.type)}
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
              <Text size="sm" lineClamp={3} style={{ whiteSpace: "pre-wrap" }}>
                {record.content}
              </Text>
              {record.resolution ? (
                <Stack gap={2}>
                  <Text size="sm" c="dimmed">
                    Phản hồi từ AgriMarket
                  </Text>
                  <Text size="sm">{record.resolution}</Text>
                </Stack>
              ) : null}
              <Button
                component={Link}
                href={`/khieu-nai/${record.id}`}
                variant="light"
                size="xs"
                w="fit-content"
                rightSection={<IconArrowRight size={14} />}
              >
                Xem chi tiết
              </Button>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}

function OrderPicker() {
  const [complaintOrder, setComplaintOrder] = useState<Order | null>(null);
  const [opened, setOpened] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.orders.list({ page: 1, limit: FETCH_LIMIT }),
    queryFn: () => resources.listMyOrders({ page: 1, limit: FETCH_LIMIT }),
  });

  const orders = useMemo(() => data?.data ?? [], [data]);

  if (isLoading) return <ListSkeleton rows={3} />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<IconMessageReport size={28} />}
        title="Bạn chưa có đơn hàng nào"
        description="Khiếu nại được gửi gắn với một đơn hàng cụ thể."
        action={
          <Button component={Link} href="/san-pham">
            Mua nông sản
          </Button>
        }
      />
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Chọn đơn hàng cần khiếu nại. Bạn có thể nêu vấn đề cho toàn bộ đơn hoặc cho một sản
        phẩm cụ thể trong đơn.
      </Text>

      {orders.map((order) => {
        const meta = orderStatusMeta(order.status);
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
                <StatusBadge label={meta.label} tone={meta.tone} />
              </Group>
              <Divider />
              <Text size="xs" c="dimmed" lineClamp={2}>
                {items.map((item) => item.productNameSnapshot).join(", ")}
              </Text>
              <Button
                variant="light"
                size="xs"
                w="fit-content"
                onClick={() => {
                  setComplaintOrder(order);
                  setOpened(true);
                }}
              >
                Gửi khiếu nại cho đơn này
              </Button>
            </Stack>
          </Card>
        );
      })}

      {complaintOrder ? (
        <ComplaintModal
          orderId={complaintOrder.id}
          items={complaintOrder.partnerOrders.flatMap((partnerOrder) => partnerOrder.items)}
          opened={opened}
          onClose={() => setOpened(false)}
        />
      ) : null}
    </Stack>
  );
}

export function ComplaintListView() {
  const [tab, setTab] = useState<string>("create");

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text size="sm">Khiếu nại</Text>
        </Breadcrumbs>

        <Stack gap={4}>
          <Title order={2}>Khiếu nại</Title>
          <Text size="sm" c="dimmed">
            Gửi khiếu nại về chất lượng sản phẩm, giao hàng hoặc sản phẩm giao không đúng.
          </Text>
        </Stack>

        <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">
            Khiếu nại gắn với đơn hàng của bạn. Vui lòng mô tả rõ vấn đề để AgriMarket xử lý
            nhanh hơn.
          </Text>
        </Alert>

        <Tabs value={tab} onChange={(value) => setTab(value ?? "create")} variant="outline">
          <Tabs.List>
            <Tabs.Tab value="create">Tạo khiếu nại</Tabs.Tab>
            <Tabs.Tab value="submitted">Khiếu nại của tôi</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="create" pt="md">
            <OrderPicker />
          </Tabs.Panel>

          <Tabs.Panel value="submitted" pt="md">
            <MyComplaints />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
