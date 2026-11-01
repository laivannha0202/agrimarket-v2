"use client";

/**
 * Order detail — the web twin of the Mobile order screen.
 *
 * Contract notes (audited against the live backend):
 *
 *  - Every line renders the order's OWN snapshot fields (`productNameSnapshot`,
 *    `skuSnapshot`, `unitPriceSnapshot`). Current catalog prices are never used
 *    here, so a later price change cannot rewrite history.
 *
 *  - `PartnerOrder.commissionAmount` / `payableAmount` are settlement data and
 *    are deliberately NOT rendered: commission, settlement and payout are not
 *    customer-facing concepts.
 *
 *  - Each item carries `allocations`: the lots it was actually fulfilled from
 *    (FEFO), with the lot's `traceCode`. That links the purchased goods straight
 *    to the public traceability page.
 *
 *  - A cancelled order is drawn as cancelled, not as a half-filled progress
 *    bar: `CANCELLED` sits off `ORDER_FLOW` (see `lib/status`).
 *
 *  - Cancelling runs the same order state machine as the admin flow, so the
 *    button is offered only for the statuses the backend accepts; a rejection is
 *    still surfaced verbatim if the order moved on in the meantime. The web
 *    keeps a confirmation step the mobile app does not have — cancelling is
 *    irreversible.
 */

import { Box, Button, Container, Divider, Group, Modal, Stack, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconBuildingStore,
  IconChevronRight,
  IconCircleX,
  IconClock,
  IconCreditCard,
  IconFileText,
  IconMapPin,
  IconMessageCircle,
  IconPrinter,
  IconQrcode,
  IconStar,
  IconTruck,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import {
  CANCELLABLE_ORDER_STATUSES,
  ORDER_FLOW,
  orderFlowIndex,
  orderStatusMeta,
  paymentMethodLabel,
  paymentStatusMeta,
  refundStatusMeta,
  RETURNABLE_ORDER_STATUSES,
  shipmentStatusMeta,
} from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState } from "@/components/common/States";
import { AppCard, FlowSteps, GhostButton, LoadingView, PageTitle } from "@/components/ui/kit";
import { layout } from "@/theme";
import type {
  Order,
  OrderItemAllocation,
  PartnerOrder,
  Payment,
  Shipment,
  ShippingAddressSnapshot,
} from "@/lib/api/types";

function snapshotAddressLine(snapshot: ShippingAddressSnapshot): string {
  return [
    snapshot.detail,
    snapshot.village,
    snapshot.wardName ?? snapshot.ward,
    snapshot.wardName ? null : snapshot.district,
    snapshot.province,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Card section heading (Mobile `section`). */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text fz={15} fw={700} c="var(--agri-text-strong)" mb={8}>
      {children}
    </Text>
  );
}

/** Muted line with a leading icon (Mobile `infoRow`). */
function InfoRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap" mt={4}>
      <Box style={{ flexShrink: 0, marginTop: 2 }}>{icon}</Box>
      <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
        {children}
      </Text>
    </Group>
  );
}

/**
 * Vertical progress tracker, exactly the Mobile drawing: a filled dot per
 * reached status with a connector rail, or the cancellation notice for an
 * order that left the flow.
 */
function OrderProgress({ order }: { order: Order }) {
  if (order.status === "CANCELLED") {
    return (
      <Group
        gap={6}
        align="flex-start"
        wrap="nowrap"
        style={{
          background: "var(--agri-danger-soft)",
          border: "1px solid var(--agri-danger)",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <IconCircleX size={18} color="var(--agri-danger)" style={{ flexShrink: 0 }} aria-hidden />
        <Text fz={12.5} lh="18px" c="var(--agri-danger)" style={{ flex: 1 }}>
          Đơn đã hủy. Hàng đã giữ cho đơn này được trả lại kho.
        </Text>
      </Group>
    );
  }

  const flowIdx = orderFlowIndex(order.status);

  return (
    <FlowSteps
      labels={ORDER_FLOW.map((status) => orderStatusMeta(status).label)}
      activeIndex={flowIdx}
    />
  );
}

/** One lot the line was fulfilled from — links to public traceability. */
function AllocationRows({ allocations }: { allocations: OrderItemAllocation[] }) {
  return (
    <>
      {allocations.map((allocation, index) => (
        <Box
          key={`${allocation.productLot.traceCode}-${index}`}
          component={Link}
          href={`/truy-xuat/${encodeURIComponent(allocation.productLot.traceCode)}`}
          className="agri-press"
          aria-label={`Truy xuất lô ${allocation.productLot.code}`}
          style={{ display: "block" }}
        >
          <Group gap={6} wrap="nowrap" style={{ minHeight: 28 }}>
            <IconQrcode size={14} color="var(--agri-primary)" aria-hidden />
            <Text fz={12.5} fw={600} c="var(--agri-primary)" truncate style={{ flex: 1 }}>
              Lô {allocation.productLot.code} · {allocation.productLot.traceCode}
            </Text>
            <IconChevronRight size={13} color="var(--agri-primary)" aria-hidden />
          </Group>
        </Box>
      ))}
    </>
  );
}

function ShipmentRows({ shipment }: { shipment: Shipment }) {
  const meta = shipmentStatusMeta(shipment.status);
  const events = shipment.events ?? [];

  return (
    <Box mt={6}>
      <Group gap={6} align="center" wrap="nowrap">
        <IconTruck size={14} color="var(--agri-muted-soft)" aria-hidden />
        <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
          {shipment.code} · {meta.label}
          {shipment.trackingCode ? ` · ${shipment.trackingCode}` : ""}
        </Text>
      </Group>
      {shipment.failureReason ? (
        <Text fz={12} lh="17px" c="var(--agri-danger)" pl={20} mt={2}>
          Lý do giao không thành công: {shipment.failureReason}
        </Text>
      ) : null}
      {events.map((event) => (
        <Text key={event.id} fz={12} lh="17px" c="var(--agri-muted)" pl={20} mt={2}>
          • {shipmentStatusMeta(event.status).label} · {formatDateTime(event.occurredAt)}
          {event.note ? ` · ${event.note}` : ""}
        </Text>
      ))}
    </Box>
  );
}

function PartnerOrderCard({ partnerOrder }: { partnerOrder: PartnerOrder }) {
  const meta = orderStatusMeta(partnerOrder.status);
  const shipments = partnerOrder.shipments ?? [];
  const canReturn = RETURNABLE_ORDER_STATUSES.includes(partnerOrder.status);

  return (
    <AppCard>
      <Group gap={6} align="center" wrap="nowrap">
        <IconBuildingStore size={16} color="var(--agri-primary)" aria-hidden />
        <Text fz={15} fw={700} c="var(--agri-text-strong)" style={{ flex: 1 }}>
          {partnerOrder.partner.name}
        </Text>
      </Group>
      <Group justify="space-between" align="center" gap={8} wrap="nowrap" mt={2} mb={8}>
        <Text fz={12.5} c="var(--agri-muted)" truncate style={{ flex: 1 }}>
          {partnerOrder.code}
        </Text>
        <StatusBadge label={meta.label} tone={meta.tone} />
      </Group>

      {partnerOrder.items.map((item) => (
        <Box
          key={item.id}
          pt={8}
          mt={4}
          style={{ borderTop: "1px solid var(--agri-border)" }}
        >
          <Group justify="space-between" align="flex-start" gap={8} wrap="nowrap">
            <Text fz={14} fw={600} c="var(--agri-text)" lineClamp={2} style={{ flex: 1 }}>
              {item.productNameSnapshot}
            </Text>
            <Text fz={14} fw={700} c="var(--agri-text-strong)" style={{ flexShrink: 0 }}>
              {formatMoney(item.subtotal)}
            </Text>
          </Group>
          <Text fz={12} lh="17px" c="var(--agri-muted)" mt={2}>
            {item.skuSnapshot} · {formatQuantity(item.quantity)} ×{" "}
            {formatMoney(item.unitPriceSnapshot)}
          </Text>
          {Number(item.discountAmount) > 0 ? (
            <Text fz={12} lh="17px" c="var(--agri-primary)" mt={2}>
              Giảm {formatMoney(item.discountAmount)}
            </Text>
          ) : null}

          <AllocationRows allocations={item.allocations ?? []} />

          {canReturn ? (
            <Group gap={8} wrap="wrap" mt={8}>
              {/* Same deep links as the Mobile order screen: the form opens on
                  the return / review page with this line already selected. */}
              <GhostButton
                component={Link}
                href={`/tra-hang?orderItemId=${item.id}`}
                radius={8}
                size="compact-sm"
                leftSection={<IconArrowBackUp size={14} aria-hidden />}
                styles={{ root: { minHeight: 34 }, label: { fontSize: 12.5, fontWeight: 600 } }}
              >
                Trả hàng
              </GhostButton>
              <GhostButton
                component={Link}
                href={`/danh-gia?orderItemId=${item.id}`}
                radius={8}
                size="compact-sm"
                leftSection={<IconStar size={14} aria-hidden />}
                styles={{ root: { minHeight: 34 }, label: { fontSize: 12.5, fontWeight: 600 } }}
              >
                Đánh giá
              </GhostButton>
            </Group>
          ) : null}
        </Box>
      ))}

      {shipments.map((shipment) => (
        <ShipmentRows key={shipment.id} shipment={shipment} />
      ))}
    </AppCard>
  );
}

/** Trigger a browser save-as from an object URL. */
function saveBlob(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Customer-facing order document.
 *
 * The PDF is produced by the backend from the order snapshot, fetched with the
 * session token (never a token in the URL) and shown as the real bytes in an
 * iframe. "In phiếu" prints that same viewer; if a browser refuses to script
 * its PDF plugin, the file is opened in a tab so the customer can still print
 * or save it.
 */
function OrderDocumentCard({ orderId, code }: { orderId: number; code: string }) {
  const [busy, setBusy] = useState<null | "view" | "download">(null);
  const [preview, setPreview] = useState<{ url: string; filename: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);

  const load = async (mode: "view" | "download") => {
    setBusy(mode);
    setError(null);
    try {
      const { blob, filename } = await resources.orderPdf(orderId);
      const url = URL.createObjectURL(blob);
      if (mode === "view") {
        setPreview({ url, filename });
      } else {
        saveBlob(url, filename);
        window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Không tải được phiếu đơn hàng.",
      );
    } finally {
      setBusy(null);
    }
  };

  const print = () => {
    const frame = frameRef.current;
    try {
      frame?.contentWindow?.focus();
      frame?.contentWindow?.print();
    } catch {
      if (preview) window.open(preview.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <AppCard padding={16}>
      <SectionTitle>Phiếu đơn hàng</SectionTitle>
      <Text fz={12.5} lh="18px" c="var(--agri-muted)" mb={8}>
        Phiếu xác nhận do hệ thống tạo từ dữ liệu của đơn này. Bản xem trước là
        chính tệp PDF, không phải bản HTML khác.
      </Text>
      <Group gap={8} wrap="wrap">
        <GhostButton
          onClick={() => void load("view")}
          loading={busy === "view"}
          radius={8}
          size="compact-sm"
          leftSection={<IconFileText size={15} aria-hidden />}
          styles={{ root: { minHeight: 34 }, label: { fontSize: 12.5, fontWeight: 600 } }}
        >
          Xem phiếu
        </GhostButton>
        <GhostButton
          onClick={() => void load("download")}
          loading={busy === "download"}
          radius={8}
          size="compact-sm"
          leftSection={<IconFileText size={15} aria-hidden />}
          styles={{ root: { minHeight: 34 }, label: { fontSize: 12.5, fontWeight: 600 } }}
        >
          Tải PDF
        </GhostButton>
      </Group>
      {error ? (
        <Text fz={12} lh="17px" c="var(--agri-danger)" mt={8}>
          {error}
        </Text>
      ) : null}

      <Modal
        opened={!!preview}
        onClose={() => setPreview(null)}
        title={`Phiếu đơn ${code}`}
        centered
        size="xl"
      >
        {preview ? (
          <iframe
            ref={frameRef}
            src={preview.url}
            title={`Phiếu đơn ${code}`}
            style={{ width: "100%", height: "70vh", border: 0 }}
          />
        ) : null}
        <Group justify="flex-end" gap={8} mt={12}>
          <Button variant="default" radius={8} onClick={() => setPreview(null)}>
            Đóng
          </Button>
          <Button
            variant="light"
            radius={8}
            leftSection={<IconPrinter size={15} aria-hidden />}
            onClick={print}
          >
            In phiếu
          </Button>
          <Button
            radius={8}
            onClick={() => {
              if (preview) saveBlob(preview.url, preview.filename);
            }}
          >
            Tải xuống
          </Button>
        </Group>
      </Modal>
    </AppCard>
  );
}

function PaymentCard({ payment, order }: { payment: Payment | undefined; order: Order }) {
  const meta = payment ? paymentStatusMeta(payment.status) : null;

  return (
    <AppCard padding={16}>
      <SectionTitle>Thanh toán</SectionTitle>

      <Group justify="space-between" gap={12} wrap="nowrap" py={3}>
        <Text fz={13} c="var(--agri-muted)">
          Tạm tính
        </Text>
        <Text fz={13.5} fw={600} c="var(--agri-text)">
          {formatMoney(order.subtotal)}
        </Text>
      </Group>
      {Number(order.discountTotal) > 0 ? (
        <Group justify="space-between" gap={12} wrap="nowrap" py={3}>
          <Text fz={13} c="var(--agri-muted)">
            Giảm giá
          </Text>
          <Text fz={13.5} fw={700} c="var(--agri-primary)">
            −{formatMoney(order.discountTotal)}
          </Text>
        </Group>
      ) : null}
      {order.voucherRedemptions.map((redemption) => (
        <Group key={redemption.id} justify="space-between" gap={12} wrap="nowrap" py={3}>
          <Text fz={13} c="var(--agri-muted)">
            Mã voucher {redemption.voucher?.code ?? `#${redemption.voucherId}`}
          </Text>
          <Text fz={13.5} fw={600} c="var(--agri-primary)">
            đã tính trong Giảm giá
          </Text>
        </Group>
      ))}
      <Group justify="space-between" gap={12} wrap="nowrap" py={3}>
        <Text fz={13} c="var(--agri-muted)">
          Phí giao hàng
        </Text>
        <Text fz={13.5} fw={600} c="var(--agri-text)">
          {formatMoney(order.shippingFee)}
        </Text>
      </Group>

      <Divider my={8} />

      <Group justify="space-between" gap={12} wrap="nowrap">
        <Text fz={15} fw={700} c="var(--agri-text-strong)">
          Tổng cộng
        </Text>
        <Text fz={17} fw={700} c="var(--agri-primary)">
          {formatMoney(order.grandTotal)}
        </Text>
      </Group>

      {payment ? (
        <InfoRow icon={<IconCreditCard size={14} color="var(--agri-muted-soft)" aria-hidden />}>
          {paymentMethodLabel(payment.method)} · {meta?.label}
          {payment.paidAt ? ` · ${formatDateTime(payment.paidAt)}` : ""}
        </InfoRow>
      ) : null}

      {(payment?.refunds ?? []).length > 0 ? (
        <>
          <Divider my={8} />
          <Text fz={13} fw={700} c="var(--agri-text-strong)" mb={4}>
            Hoàn tiền
          </Text>
          {(payment?.refunds ?? []).map((refund) => {
            // An amount alone reads as "money returned". The status is what
            // tells the customer whether it has actually been paid out.
            const meta = refundStatusMeta(refund.status);
            return (
              <Group
                key={refund.id}
                justify="space-between"
                align="flex-start"
                gap={12}
                wrap="nowrap"
                py={4}
              >
                <Stack gap={3} style={{ minWidth: 0 }}>
                  <Text fz={13} c="var(--agri-muted)">
                    {refund.reason ?? "Hoàn tiền cho đơn hàng"}
                  </Text>
                  <StatusBadge label={meta.label} tone={meta.tone} />
                </Stack>
                <Text fz={13.5} fw={600} c="var(--agri-text)" style={{ flexShrink: 0 }}>
                  {formatMoney(refund.amount)}
                </Text>
              </Group>
            );
          })}
        </>
      ) : null}

      {payment?.status === "PENDING" && payment.method === "COD" ? (
        <Text fz={12} lh="17px" c="var(--agri-muted)" mt={8}>
          Bạn thanh toán tiền mặt cho đơn vị vận chuyển khi nhận hàng. Trạng thái
          thanh toán chỉ chuyển sang đã thanh toán sau khi cửa hàng xác nhận đã thu
          được tiền — hệ thống không tự đổi trạng thái chỉ vì đơn đã giao.
        </Text>
      ) : null}
    </AppCard>
  );
}

export function OrderDetail({ orderId }: { orderId: number }) {
  const queryClient = useQueryClient();
  const [cancelOpened, setCancelOpened] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const { data: order, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.orders.detail(orderId),
    queryFn: () => resources.getMyOrder(orderId),
  });

  const cancelOrder = useMutation({
    mutationFn: () => resources.cancelMyOrder(orderId),
    onSuccess: () => {
      setCancelError(null);
      setCancelOpened(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      notifications.show({
        title: "Đã hủy đơn hàng",
        message: "Đơn hàng đã được hủy và hàng đã được trả về kho.",
        color: "agri",
      });
    },
    onError: (err) => {
      // The state machine may have moved on (e.g. the order shipped) — show the
      // backend's own message instead of guessing.
      const message =
        err instanceof ApiError ? err.message : "Không hủy được đơn hàng. Vui lòng thử lại.";
      setCancelError(message);
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });
    },
  });

  if (isLoading) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
        <LoadingView label="Đang tải đơn hàng…" />
      </Container>
    );
  }

  if (isError || !order) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
        <ErrorState
          error={error}
          onRetry={() => refetch()}
          title="Không tải được đơn hàng"
        />
        <Group justify="center" mt={12}>
          <GhostButton
            component={Link}
            href="/don-hang"
            radius={8}
            styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 600 } }}
          >
            Về danh sách đơn hàng
          </GhostButton>
        </Group>
      </Container>
    );
  }

  const statusMeta = orderStatusMeta(order.status);
  const payment = order.payments[0];
  const snapshot = order.shippingAddressSnapshot;
  const addressLine = snapshotAddressLine(snapshot);
  const canCancel = CANCELLABLE_ORDER_STATUSES.includes(order.status);

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <Stack gap={12}>
        <PageTitle>Chi tiết đơn</PageTitle>

        <Group align="flex-start" gap={12} wrap="wrap">
          {/* ------------------------------------------------------- main ---- */}
          <Stack gap={8} style={{ flex: "1 1 420px", minWidth: 0 }}>
            {/* Summary card */}
            <AppCard>
              <Group justify="space-between" align="center" gap={8} wrap="nowrap">
                <Text fz={16} fw={700} c="var(--agri-text-strong)" truncate style={{ flex: 1 }}>
                  {order.code}
                </Text>
                <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
              </Group>

              <InfoRow icon={<IconClock size={14} color="var(--agri-muted-soft)" aria-hidden />}>
                Đặt lúc {formatDateTime(order.createdAt)}
              </InfoRow>
              {snapshot.recipientName || snapshot.phone ? (
                <InfoRow icon={<IconUser size={14} color="var(--agri-muted-soft)" aria-hidden />}>
                  {[snapshot.recipientName, snapshot.phone].filter(Boolean).join(" · ")}
                </InfoRow>
              ) : null}
              {addressLine ? (
                <InfoRow icon={<IconMapPin size={14} color="var(--agri-muted-soft)" aria-hidden />}>
                  {addressLine}
                </InfoRow>
              ) : null}
              {order.note ? (
                <InfoRow
                  icon={<IconMessageCircle size={14} color="var(--agri-muted-soft)" aria-hidden />}
                >
                  {order.note}
                </InfoRow>
              ) : null}

              <GhostButton
                component={Link}
                href={`/khieu-nai?orderId=${order.id}`}
                radius={8}
                size="compact-sm"
                leftSection={<IconMessageCircle size={15} aria-hidden />}
                mt={10}
                w="fit-content"
                styles={{ root: { minHeight: 34 }, label: { fontSize: 12.5, fontWeight: 600 } }}
              >
                Khiếu nại về đơn này
              </GhostButton>
            </AppCard>

            {/* Progress */}
            <AppCard>
              <SectionTitle>Tiến trình đơn hàng</SectionTitle>
              <OrderProgress order={order} />
            </AppCard>

            {/* Supplier sub-orders */}
            {order.partnerOrders.map((partnerOrder) => (
              <PartnerOrderCard key={partnerOrder.id} partnerOrder={partnerOrder} />
            ))}

            {/* After-sales */}
            <AppCard>
              <SectionTitle>Sau giao hàng</SectionTitle>
              <Text fz={12.5} lh="18px" c="var(--agri-muted)" mb={8}>
                Trả hàng, khiếu nại và đánh giá chỉ áp dụng cho đơn đã giao.
              </Text>
              <Group gap={8} wrap="wrap">
                <GhostButton
                  component={Link}
                  href="/tra-hang"
                  radius={8}
                  size="compact-sm"
                  styles={{ root: { minHeight: 34 }, label: { fontSize: 12.5, fontWeight: 600 } }}
                >
                  Trả hàng
                </GhostButton>
                <GhostButton
                  component={Link}
                  href="/khieu-nai"
                  radius={8}
                  size="compact-sm"
                  styles={{ root: { minHeight: 34 }, label: { fontSize: 12.5, fontWeight: 600 } }}
                >
                  Khiếu nại
                </GhostButton>
                <GhostButton
                  component={Link}
                  href="/danh-gia"
                  radius={8}
                  size="compact-sm"
                  styles={{ root: { minHeight: 34 }, label: { fontSize: 12.5, fontWeight: 600 } }}
                >
                  Đánh giá
                </GhostButton>
              </Group>
            </AppCard>
          </Stack>

          {/* ------------------------------------------------------ aside ---- */}
          <Stack gap={8} w={{ base: "100%", md: 340 }} style={{ flexShrink: 0 }}>
            <PaymentCard payment={payment} order={order} />

            <OrderDocumentCard orderId={order.id} code={order.code} />

            {canCancel ? (
              <AppCard padding={16}>
                <SectionTitle>Hủy đơn</SectionTitle>
                <Text fz={12.5} lh="18px" c="var(--agri-muted)" mb={8}>
                  Chỉ hủy được khi đơn chưa giao. Sau khi hủy, hàng đã giữ sẽ được trả lại
                  kho.
                </Text>

                {cancelError ? (
                  <Group gap={6} align="flex-start" wrap="nowrap" mb={8}>
                    <IconAlertCircle
                      size={15}
                      color="var(--agri-danger)"
                      style={{ flexShrink: 0, marginTop: 2 }}
                    />
                    <Text fz={12.5} lh="18px" c="var(--agri-danger)" style={{ flex: 1 }}>
                      {cancelError}
                    </Text>
                  </Group>
                ) : null}

                <Button
                  variant="light"
                  color="red"
                  radius={8}
                  fullWidth
                  leftSection={<IconCircleX size={17} aria-hidden />}
                  onClick={() => {
                    setCancelError(null);
                    setCancelOpened(true);
                  }}
                  styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 700 } }}
                >
                  Hủy đơn hàng
                </Button>
              </AppCard>
            ) : null}
          </Stack>
        </Group>
      </Stack>

      <Modal
        opened={cancelOpened}
        onClose={() => setCancelOpened(false)}
        title="Hủy đơn hàng"
        centered
        size="md"
      >
        <Stack gap="md">
          <Text fz={13.5} lh="19px" c="var(--agri-text)">
            Bạn chắc chắn muốn hủy đơn hàng {order.code}? Hàng đã giữ cho đơn này sẽ được
            trả về kho và không thể hoàn tác.
          </Text>

          {cancelError ? (
            <Group
              gap={6}
              align="flex-start"
              wrap="nowrap"
              style={{
                background: "var(--agri-danger-soft)",
                border: "1px solid var(--agri-danger)",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <IconAlertCircle
                size={16}
                color="var(--agri-danger)"
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              <Text fz={12.5} lh="18px" c="var(--agri-danger)" style={{ flex: 1 }}>
                {cancelError}
              </Text>
            </Group>
          ) : null}

          <Group justify="flex-end" gap="sm">
            <GhostButton radius={8} onClick={() => setCancelOpened(false)}>
              Giữ đơn hàng
            </GhostButton>
            <Button
              color="red"
              radius={8}
              loading={cancelOrder.isPending}
              onClick={() => cancelOrder.mutate()}
            >
              Hủy đơn hàng
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
