"use client";

/**
 * Order detail.
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
 *  - Shipments embed their `events` (ascending), which is what the timeline
 *    below renders. Internal fields are not part of the customer projection.
 *
 *  - Cancelling runs the same order state machine as the admin flow, so the
 *    button is offered only for the statuses the backend accepts; a rejection is
 *    still surfaced verbatim if the order moved on in the meantime.
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
  Modal,
  SimpleGrid,
  Stack,
  Stepper,
  Text,
  Timeline,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCircleCheck,
  IconInfoCircle,
  IconMapPin,
  IconPackage,
  IconQrcode,
  IconReceipt,
  IconTruck,
} from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate, formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import {
  CANCELLABLE_ORDER_STATUSES,
  lotStatusMeta,
  orderStatusMeta,
  paymentMethodLabel,
  paymentStatusMeta,
  RETURNABLE_ORDER_STATUSES,
  shipmentStatusMeta,
} from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { DetailSkeleton, ErrorState } from "@/components/common/States";
import { ComplaintModal } from "@/components/order/ComplaintModal";
import { ReturnRequestModal } from "@/components/order/ReturnRequestModal";
import { ReviewModal } from "@/components/order/ReviewModal";
import { layout } from "@/theme";
import type {
  Order,
  OrderItem,
  OrderItemAllocation,
  PartnerOrder,
  Payment,
  Shipment,
  ShippingAddressSnapshot,
} from "@/lib/api/types";

const PROGRESS_STEPS: Array<{ status: string; label: string }> = [
  { status: "PENDING_CONFIRMATION", label: "Chờ xác nhận" },
  { status: "CONFIRMED", label: "Đã xác nhận" },
  { status: "PREPARING", label: "Đang chuẩn bị" },
  { status: "READY_TO_SHIP", label: "Chờ giao" },
  { status: "SHIPPING", label: "Đang giao" },
  { status: "DELIVERED", label: "Đã giao" },
];

function addressLines(snapshot: ShippingAddressSnapshot): string[] {
  const lines: string[] = [];
  if (snapshot.recipientName || snapshot.phone) {
    lines.push(
      [snapshot.recipientName, snapshot.phone].filter(Boolean).join(" · "),
    );
  }
  const detail = [snapshot.detail, snapshot.village, snapshot.ward, snapshot.district, snapshot.province]
    .filter(Boolean)
    .join(", ");
  if (detail) lines.push(detail);
  return lines;
}

function OrderProgress({ order }: { order: Order }) {
  if (order.status === "CANCELLED") {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} title="Đơn hàng đã hủy">
        <Text size="sm">
          Đơn hàng đã được hủy. Nếu bạn đã thanh toán, khoản hoàn tiền sẽ được xử lý theo
          chính sách của AgriMarket.
        </Text>
      </Alert>
    );
  }

  const activeIndex = PROGRESS_STEPS.findIndex((step) => step.status === order.status);

  return (
    <Stepper active={activeIndex < 0 ? 0 : activeIndex} size="sm" iconSize={26}>
      {PROGRESS_STEPS.map((step) => (
        <Stepper.Step key={step.status} label={step.label} />
      ))}
    </Stepper>
  );
}

function ShipmentBlock({ shipment }: { shipment: Shipment }) {
  const meta = shipmentStatusMeta(shipment.status);
  const events = shipment.events ?? [];

  return (
    <Card padding="sm" radius="md" withBorder>
      <Stack gap="xs">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap">
            <IconTruck size={16} color="var(--mantine-color-gray-7)" />
            <Text size="sm" fw={600}>
              {shipment.carrier ?? "Đơn vị vận chuyển"}
            </Text>
          </Group>
          <StatusBadge label={meta.label} tone={meta.tone} size="xs" />
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <Group gap={6} wrap="wrap">
            <Text size="xs" c="dimmed">
              Mã vận đơn
            </Text>
            <Text size="xs" fw={600}>
              {shipment.trackingCode ?? "Chưa có"}
            </Text>
          </Group>
          <Group gap={6} wrap="wrap">
            <Text size="xs" c="dimmed">
              Giao lúc
            </Text>
            <Text size="xs">{shipment.deliveredAt ? formatDateTime(shipment.deliveredAt) : "—"}</Text>
          </Group>
          <Group gap={6} wrap="wrap">
            <Text size="xs" c="dimmed">
              Bắt đầu giao
            </Text>
            <Text size="xs">{shipment.shippedAt ? formatDateTime(shipment.shippedAt) : "—"}</Text>
          </Group>
        </SimpleGrid>

        {shipment.failureReason ? (
          <Alert color="orange" variant="light" icon={<IconAlertCircle size={15} />}>
            <Text size="xs">Lý do giao không thành công: {shipment.failureReason}</Text>
          </Alert>
        ) : null}

        {events.length > 0 ? (
          <>
            <Divider />
            <Timeline active={events.length - 1} bulletSize={18} lineWidth={2}>
              {events.map((event) => {
                const eventMeta = shipmentStatusMeta(event.status);
                return (
                  <Timeline.Item
                    key={event.id}
                    bullet={<IconCircleCheck size={11} />}
                    title={
                      <Group gap="xs" wrap="wrap">
                        <Text size="xs" fw={600}>
                          {eventMeta.label}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {formatDateTime(event.occurredAt)}
                        </Text>
                      </Group>
                    }
                  >
                    {event.note ? (
                      <Text size="xs" c="dimmed">
                        {event.note}
                      </Text>
                    ) : null}
                  </Timeline.Item>
                );
              })}
            </Timeline>
          </>
        ) : (
          <Text size="xs" c="dimmed">
            Chưa có cập nhật hành trình cho kiện hàng này.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/** The lots this line was fulfilled from, with a link to public traceability. */
function AllocationsBlock({ allocations }: { allocations: OrderItemAllocation[] }) {
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} c="dimmed">
        Lô hàng đã xuất cho sản phẩm này
      </Text>
      {allocations.map((allocation, index) => {
        const meta = lotStatusMeta(allocation.productLot.status);
        return (
          <Group key={index} gap="xs" wrap="wrap">
            <Badge size="xs" variant="light" color="gray" radius="sm">
              Lô {allocation.productLot.code}
            </Badge>
            <StatusBadge label={meta.label} tone={meta.tone} size="xs" />
            <Text size="xs" c="dimmed">
              {formatQuantity(allocation.quantity)} {allocation.productLot.unit} · Hạn dùng{" "}
              {formatDate(allocation.productLot.expiresAt)}
            </Text>
            <Button
              component={Link}
              href={`/truy-xuat/${encodeURIComponent(allocation.productLot.traceCode)}`}
              size="compact-xs"
              variant="subtle"
              leftSection={<IconQrcode size={13} />}
            >
              Truy xuất nguồn gốc
            </Button>
          </Group>
        );
      })}
    </Stack>
  );
}

function PartnerOrderBlock({
  partnerOrder,
  onReturn,
  onReview,
}: {
  partnerOrder: PartnerOrder;
  onReturn: (item: OrderItem) => void;
  onReview: (item: OrderItem) => void;
}) {
  const meta = orderStatusMeta(partnerOrder.status);
  const shipments = partnerOrder.shipments ?? [];
  const canReturn = RETURNABLE_ORDER_STATUSES.includes(partnerOrder.status);

  return (
    <Card padding="lg" radius="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap">
            <IconPackage size={18} color="var(--mantine-color-agri-8)" />
            <Text size="sm" fw={700}>
              {partnerOrder.partner.name}
            </Text>
          </Group>
          <StatusBadge label={meta.label} tone={meta.tone} />
        </Group>

        <Divider />

        <Stack gap="sm">
          {partnerOrder.items.map((item) => (
            <Card key={item.id} padding="sm" radius="md" withBorder>
              <Stack gap="xs">
                <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
                  <Stack gap={2} style={{ flex: 1, minWidth: 200 }}>
                    <Text size="sm" fw={600}>
                      {item.productNameSnapshot}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Mã hàng: {item.skuSnapshot}
                    </Text>
                  </Stack>
                  <Stack gap={2} align="flex-end">
                    <Text size="sm" fw={600}>
                      {formatMoney(item.subtotal)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {formatMoney(item.unitPriceSnapshot)} × {formatQuantity(item.quantity)}
                    </Text>
                  </Stack>
                </Group>

                {(item.allocations ?? []).length > 0 ? (
                  <>
                    <Divider />
                    <AllocationsBlock allocations={item.allocations ?? []} />
                  </>
                ) : null}

                {canReturn ? (
                  <Group gap="xs" wrap="wrap">
                    <Button
                      size="compact-xs"
                      variant="light"
                      onClick={() => onReturn(item)}
                    >
                      Yêu cầu trả hàng
                    </Button>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => onReview(item)}
                    >
                      Đánh giá sản phẩm
                    </Button>
                  </Group>
                ) : null}
              </Stack>
            </Card>
          ))}
        </Stack>

        {shipments.length > 0 ? (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Vận chuyển
            </Text>
            {shipments.map((shipment) => (
              <ShipmentBlock key={shipment.id} shipment={shipment} />
            ))}
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">
            Kiện hàng này chưa có thông tin vận chuyển.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

function PaymentBlock({ payment }: { payment: Payment }) {
  const meta = paymentStatusMeta(payment.status);

  return (
    <Card padding="lg" radius="md" withBorder>
      <Stack gap="md">
        <Group gap="sm">
          <IconReceipt size={18} color="var(--mantine-color-agri-8)" />
          <Title order={4}>Thanh toán</Title>
        </Group>
        <Divider />
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text size="sm" c="dimmed">
            Phương thức
          </Text>
          <Text size="sm" fw={600}>
            {paymentMethodLabel(payment.method)}
          </Text>
        </Group>
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text size="sm" c="dimmed">
            Số tiền
          </Text>
          <Text size="sm" fw={600}>
            {formatMoney(payment.amount)}
          </Text>
        </Group>
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text size="sm" c="dimmed">
            Trạng thái
          </Text>
          <StatusBadge label={meta.label} tone={meta.tone} />
        </Group>
        {payment.paidAt ? (
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text size="sm" c="dimmed">
              Thời điểm thanh toán
            </Text>
            <Text size="sm">{formatDateTime(payment.paidAt)}</Text>
          </Group>
        ) : null}

        {(payment.refunds ?? []).length > 0 ? (
          <Stack gap="xs">
            <Divider />
            <Text size="sm" fw={600}>
              Hoàn tiền
            </Text>
            {(payment.refunds ?? []).map((refund) => (
              <Group key={refund.id} justify="space-between" wrap="wrap" gap="xs">
                <Text size="sm">{refund.reason ?? "Hoàn tiền cho đơn hàng"}</Text>
                <Text size="sm" fw={600}>
                  {formatMoney(refund.amount)}
                </Text>
              </Group>
            ))}
          </Stack>
        ) : null}

        {payment.status === "PENDING" && payment.method === "COD" ? (
          <Text size="xs" c="dimmed">
            Đơn hàng COD được thanh toán khi bạn nhận hàng. Trạng thái sẽ chuyển sang đã
            thanh toán sau khi giao thành công.
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

export function OrderDetail({ orderId }: { orderId: number }) {
  const queryClient = useQueryClient();
  const [returnItem, setReturnItem] = useState<OrderItem | null>(null);
  const [reviewItem, setReviewItem] = useState<OrderItem | null>(null);
  const [complaintOpened, setComplaintOpened] = useState(false);
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
      <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
        <DetailSkeleton />
      </Container>
    );
  }

  if (isError || !order) {
    return (
      <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
        <ErrorState
          error={error}
          onRetry={() => refetch()}
          title="Không tải được đơn hàng"
        />
        <Group mt="lg">
          <Button component={Link} href="/don-hang" variant="default" leftSection={<IconArrowLeft size={16} />}>
            Về danh sách đơn hàng
          </Button>
        </Group>
      </Container>
    );
  }

  const statusMeta = orderStatusMeta(order.status);
  const payment = order.payments[0];
  const canCancel = CANCELLABLE_ORDER_STATUSES.includes(order.status);
  const address = addressLines(order.shippingAddressSnapshot);

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text component={Link} href="/don-hang" size="sm" c="dimmed">
            Đơn hàng
          </Text>
          <Text size="sm">{order.code}</Text>
        </Breadcrumbs>

        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Stack gap={4}>
            <Group gap="sm" wrap="wrap">
              <Title order={2}>{order.code}</Title>
              <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
            </Group>
            <Text size="sm" c="dimmed">
              Đặt hàng lúc {formatDateTime(order.createdAt)}
            </Text>
          </Stack>

          <Group gap="xs" wrap="wrap">
            {canCancel ? (
              <Button
                variant="light"
                color="red"
                size="sm"
                onClick={() => {
                  setCancelError(null);
                  setCancelOpened(true);
                }}
              >
                Hủy đơn hàng
              </Button>
            ) : null}
            <Button
              variant="light"
              size="sm"
              onClick={() => setComplaintOpened(true)}
            >
              Gửi khiếu nại
            </Button>
          </Group>
        </Group>

        <Card padding="lg" radius="md" withBorder>
          <OrderProgress order={order} />
        </Card>

        <Group align="flex-start" gap="lg" wrap="wrap">
          <Stack gap="md" style={{ flex: 1, minWidth: 320 }}>
            {/* Address + note */}
            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Group gap="sm">
                  <IconMapPin size={18} color="var(--mantine-color-agri-8)" />
                  <Title order={4}>Địa chỉ nhận hàng</Title>
                </Group>
                <Divider />
                {address.length > 0 ? (
                  <Stack gap={2}>
                    {address.map((line) => (
                      <Text key={line} size="sm">
                        {line}
                      </Text>
                    ))}
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    Đơn hàng không có thông tin địa chỉ nhận hàng.
                  </Text>
                )}
                {order.note ? (
                  <>
                    <Divider />
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>
                        Ghi chú của bạn
                      </Text>
                      <Text size="sm" c="dimmed">
                        {order.note}
                      </Text>
                    </Stack>
                  </>
                ) : null}
              </Stack>
            </Card>

            {/* Partner orders */}
            {order.partnerOrders.map((partnerOrder) => (
              <PartnerOrderBlock
                key={partnerOrder.id}
                partnerOrder={partnerOrder}
                onReturn={setReturnItem}
                onReview={setReviewItem}
              />
            ))}

            {/* Traceability note */}
            <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
              <Stack gap="xs">
                <Text size="sm">
                  Mỗi sản phẩm ở trên hiển thị lô hàng đã xuất kho kèm mã truy xuất. Bạn cũng
                  có thể tra cứu trực tiếp bằng mã in trên bao bì.
                </Text>
                <Button
                  component={Link}
                  href="/truy-xuat"
                  size="xs"
                  variant="light"
                  color="gray"
                  w="fit-content"
                  leftSection={<IconQrcode size={14} />}
                >
                  Đi tới tra cứu
                </Button>
              </Stack>
            </Alert>
          </Stack>

          {/* Summary */}
          <Stack gap="md" w={{ base: "100%", md: 340 }} style={{ flexShrink: 0 }}>
            <Card padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Title order={4}>Tổng kết đơn hàng</Title>
                <Divider />

                <Stack gap="xs">
                  <Group justify="space-between" wrap="wrap">
                    <Text size="sm" c="dimmed">
                      Tạm tính
                    </Text>
                    <Text size="sm">{formatMoney(order.subtotal)}</Text>
                  </Group>
                  {Number(order.discountTotal) > 0 ? (
                    <Group justify="space-between" wrap="wrap">
                      <Text size="sm" c="dimmed">
                        Giảm giá
                      </Text>
                      <Text size="sm">-{formatMoney(order.discountTotal)}</Text>
                    </Group>
                  ) : null}
                  <Group justify="space-between" wrap="wrap">
                    <Text size="sm" c="dimmed">
                      Phí giao hàng
                    </Text>
                    <Text size="sm">{formatMoney(order.shippingFee)}</Text>
                  </Group>
                </Stack>

                <Divider />

                <Group justify="space-between" wrap="wrap">
                  <Text size="sm" fw={600}>
                    Tổng thanh toán
                  </Text>
                  <Text size="md" fw={700} c="agri.9">
                    {formatMoney(order.grandTotal)}
                  </Text>
                </Group>

                {order.voucherRedemptions.length > 0 ? (
                  <>
                    <Divider />
                    <Stack gap="xs">
                      <Text size="sm" fw={600}>
                        Mã giảm giá đã dùng
                      </Text>
                      {order.voucherRedemptions.map((redemption) => (
                        <Group key={redemption.id} justify="space-between" wrap="wrap">
                          <Text size="sm" c="dimmed">
                            Mã giảm giá
                          </Text>
                          <Text size="sm" fw={600}>
                            -{formatMoney(redemption.discountAmount)}
                          </Text>
                        </Group>
                      ))}
                    </Stack>
                  </>
                ) : null}

                <Text size="xs" c="dimmed">
                  Ngày đặt hàng: {formatDate(order.createdAt)}
                </Text>
              </Stack>
            </Card>

            {payment ? <PaymentBlock payment={payment} /> : null}

            <Card padding="lg" radius="md" withBorder>
              <Stack gap="sm">
                <Text size="sm" fw={600}>
                  Số kiện hàng
                </Text>
                <Group gap="xs" wrap="wrap">
                  <Badge variant="light" color="blue" radius="sm">
                    {order.partnerOrders.length} kiện từ {order.partnerOrders.length} đối tác
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  Mỗi đối tác chuẩn bị và giao riêng kiện hàng của mình, vì vậy các kiện có
                  thể đến bạn ở những thời điểm khác nhau.
                </Text>
              </Stack>
            </Card>

            <Button
              component={Link}
              href="/don-hang"
              variant="default"
              leftSection={<IconArrowLeft size={16} />}
            >
              Về danh sách đơn hàng
            </Button>
          </Stack>
        </Group>
      </Stack>

      {returnItem ? (
        <ReturnRequestModal
          orderItem={returnItem}
          opened
          onClose={() => setReturnItem(null)}
        />
      ) : null}

      {reviewItem ? (
        <ReviewModal
          orderItem={reviewItem}
          opened
          onClose={() => setReviewItem(null)}
        />
      ) : null}

      <ComplaintModal
        orderId={order.id}
        items={order.partnerOrders.flatMap((partnerOrder) => partnerOrder.items)}
        opened={complaintOpened}
        onClose={() => setComplaintOpened(false)}
      />

      <Modal
        opened={cancelOpened}
        onClose={() => setCancelOpened(false)}
        title="Hủy đơn hàng"
        centered
        size="md"
      >
        <Stack gap="md">
          <Text size="sm">
            Bạn chắc chắn muốn hủy đơn hàng {order.code}? Hàng đã giữ cho đơn này sẽ được trả
            về kho và không thể hoàn tác.
          </Text>

          {cancelError ? (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              <Text size="sm">{cancelError}</Text>
            </Alert>
          ) : null}

          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setCancelOpened(false)}>
              Giữ đơn hàng
            </Button>
            <Button
              color="red"
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
