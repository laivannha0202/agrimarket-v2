"use client";

/**
 * Order success — the web twin of the Mobile "Đặt hàng thành công" banner.
 *
 * Confirms the order code and the COD state honestly: a COD order is created as
 * PENDING, so "Đã thanh toán" is never shown here. Every number (total, parcel
 * count) is the backend's own.
 */

import { Button, Container, Group, Stack, Text } from "@mantine/core";
import { IconCircleCheck, IconShoppingBag } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, formatMoney } from "@/lib/format";
import { orderStatusMeta, paymentStatusMeta } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState } from "@/components/common/States";
import { AppCard, GhostButton, KVRow, LoadingView } from "@/components/ui/kit";

export function CheckoutSuccess({ orderId }: { orderId: number }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.orders.detail(orderId),
    queryFn: () => resources.getMyOrder(orderId),
  });

  if (isLoading) {
    return (
      <Container size="sm" px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 40 }}>
        <LoadingView label="Đang tải đơn hàng…" />
      </Container>
    );
  }

  if (isError) {
    return (
      <Container size="sm" px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 40 }}>
        <ErrorState error={error} onRetry={() => refetch()} />
      </Container>
    );
  }

  const order = data;
  if (!order) return null;

  const payment = order.payments[0];
  const snapshot = order.shippingAddressSnapshot;

  /** One-line delivery address of the order snapshot (what the backend stored). */
  const addressLine = [
    snapshot.detail,
    snapshot.village,
    snapshot.wardName ?? snapshot.ward,
    snapshot.wardName ? null : snapshot.district,
    snapshot.province,
  ]
    .filter(Boolean)
    .join(", ");

  const statusMeta = orderStatusMeta(order.status);

  return (
    <Container size="sm" px={{ base: 12, sm: "lg" }} py={{ base: 16, sm: 40 }}>
      <Stack gap={12}>
        {/* --------------------------------------------------------- banner -- */}
        <AppCard
          style={{
            border: "1px solid var(--agri-primary-border)",
            background: "var(--agri-primary-soft)",
          }}
        >
          <Group gap={8} wrap="nowrap" align="center">
            <IconCircleCheck size={22} color="var(--agri-primary)" aria-hidden />
            <Text fz={15} fw={700} c="var(--agri-primary-dark)">
              Đặt hàng thành công
            </Text>
          </Group>
          <Text fz={12.5} c="var(--agri-muted)" mt={6} style={{ lineHeight: "18px" }}>
            Mã đơn {order.code}. Thanh toán tiền mặt khi nhận hàng (COD).
          </Text>
        </AppCard>

        {/* -------------------------------------------------------- summary -- */}
        <AppCard padding={16}>
          <Group justify="space-between" gap={12} wrap="nowrap" mb={8}>
            <Text fz={15} fw={700} c="var(--agri-text-strong)">
              {order.code}
            </Text>
            <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
          </Group>
          <Stack gap={6}>
            <KVRow
              label="Tổng tiền"
              strong
              valueColor="var(--agri-primary)"
              value={formatMoney(order.grandTotal)}
            />
            <KVRow label="Đặt lúc" value={formatDateTime(order.createdAt)} />
            {snapshot.recipientName ? (
              <KVRow
                label="Người nhận"
                value={[snapshot.recipientName, snapshot.phone].filter(Boolean).join(" · ")}
              />
            ) : null}
            {addressLine ? <KVRow label="Giao đến" value={addressLine} /> : null}
            {payment ? (
              <KVRow
                label="Thanh toán"
                value={
                  <StatusBadge
                    label={paymentStatusMeta(payment.status).label}
                    tone={paymentStatusMeta(payment.status).tone}
                  />
                }
              />
            ) : null}
            <KVRow
              label="Số kiện hàng"
              value={`${order.partnerOrders.length} kiện từ ${order.partnerOrders.length} đối tác`}
            />
          </Stack>
        </AppCard>

        <Text fz={12.5} c="var(--agri-muted)" ta="center" style={{ lineHeight: "18px" }}>
          Đơn hàng COD được thanh toán khi bạn nhận hàng. Trạng thái thanh toán sẽ cập nhật
          sau khi giao thành công.
        </Text>

        {/* --------------------------------------------------------- actions -- */}
        <Group grow gap={8} wrap="nowrap">
          <Button
            component={Link}
            href={`/don-hang/${order.id}`}
            radius={8}
            size="md"
            leftSection={<IconShoppingBag size={18} aria-hidden />}
            styles={{ root: { minHeight: 48 }, label: { fontSize: 14, fontWeight: 700 } }}
          >
            Xem đơn hàng
          </Button>
          <GhostButton
            component={Link}
            href="/san-pham"
            radius={8}
            size="md"
            styles={{ root: { minHeight: 48 }, label: { fontSize: 14, fontWeight: 700 } }}
          >
            Tiếp tục mua sắm
          </GhostButton>
        </Group>
      </Stack>
    </Container>
  );
}
