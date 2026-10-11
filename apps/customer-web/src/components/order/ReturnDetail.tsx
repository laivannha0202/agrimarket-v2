"use client";

/**
 * Return request detail.
 *
 * Reads the caller's own request from `GET /returns/me/:id`, so the status is
 * always the current server state (not a stale snapshot from when it was sent)
 * and the page works after a re-login or on another device.
 */

import {
  Alert,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Stack,
  Text,
  Timeline,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconInfoCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { returnStatusMeta } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EvidenceGallery } from "@/components/common/EvidenceGallery";
import { DetailSkeleton, ErrorState, NotFoundState } from "@/components/common/States";
import { ApiError } from "@/lib/api/client";

/** The documented return flow, used to show where the request currently sits. */
const FLOW: Array<{ status: string; label: string; description: string }> = [
  { status: "REQUESTED", label: "Đã gửi yêu cầu", description: "AgriMarket đã nhận yêu cầu trả hàng." },
  { status: "APPROVED", label: "Đã chấp nhận", description: "Yêu cầu được chấp nhận, hàng sẽ được thu hồi." },
  { status: "RETURNING", label: "Đang gửi trả", description: "Hàng đang trên đường về kho." },
  { status: "RECEIVED", label: "Đã nhận hàng trả", description: "Kho đã nhận lại hàng." },
  { status: "QC_PENDING", label: "Chờ kiểm định", description: "Hàng trả về đang được kiểm định lại." },
  { status: "REFUNDED", label: "Đã hoàn tiền", description: "Khoản hoàn tiền đã được xử lý." },
];

export function ReturnDetail({ returnId }: { returnId: number | null }) {
  const { data: record, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.returns.detail(returnId ?? 0),
    queryFn: () => resources.getMyReturn(returnId as number),
    enabled: returnId !== null,
  });

  if (returnId === null || (isError && error instanceof ApiError && error.status === 404)) {
    return (
      <Container size="sm" px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 48 }}>
        <NotFoundState
          title="Không tìm thấy yêu cầu trả hàng"
          description="Yêu cầu này không tồn tại hoặc không thuộc tài khoản của bạn."
          action={
            <Button component={Link} href="/tra-hang">
              Về trang trả hàng
            </Button>
          }
        />
      </Container>
    );
  }

  if (isLoading) {
    return (
      <Container size="md" px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
        <DetailSkeleton />
      </Container>
    );
  }

  if (isError || !record) {
    return (
      <Container size="md" px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
        <ErrorState error={error} onRetry={() => refetch()} />
      </Container>
    );
  }

  const meta = returnStatusMeta(record.status);
  const rejected = record.status === "REJECTED";
  const activeIndex = FLOW.findIndex((step) => step.status === record.status);

  return (
    <Container size="md" px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Group justify="space-between" wrap="wrap" gap="md">
          <Stack gap={4}>
            <Title order={2}>Yêu cầu trả hàng #{record.id}</Title>
            <Text size="sm" c="dimmed">
              Gửi lúc {formatDateTime(record.createdAt)}
            </Text>
          </Stack>
          <StatusBadge label={meta.label} tone={meta.tone} />
        </Group>

        <Card padding="lg" radius="md" withBorder>
          <Stack gap="md">
            <Title order={4}>Nội dung yêu cầu</Title>
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
              <Text size="sm" fw={600}>
                {formatQuantity(record.quantity)}
              </Text>
            </Group>
            <Stack gap={2}>
              <Text size="sm" c="dimmed">
                Lý do
              </Text>
              <Text size="sm">{record.reason}</Text>
            </Stack>
            {/**
             * The photos the customer attached when the request was created.
             * Only the owner (and an ADMIN) can load them; the component
             * fetches each one with the session.
             */}
            <EvidenceGallery images={record.evidence} label="Ảnh minh chứng đã gửi" />
            {record.refund ? (
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Text size="sm" c="dimmed">
                  Số tiền hoàn
                </Text>
                <Text size="sm" fw={600}>
                  {formatMoney(record.refund.amount)}
                </Text>
              </Group>
            ) : null}
            <Button
              component={Link}
              href={`/don-hang/${record.orderId}`}
              variant="light"
              size="sm"
              w="fit-content"
            >
              Xem đơn hàng liên quan
            </Button>
          </Stack>
        </Card>

        <Card padding="lg" radius="md" withBorder>
          <Stack gap="md">
            <Title order={4}>Tiến trình xử lý</Title>
            <Divider />
            {rejected ? (
              <Alert color="red" variant="light" icon={<IconInfoCircle size={16} />}>
                <Text size="sm">
                  Yêu cầu trả hàng đã bị từ chối. Vui lòng liên hệ bộ phận hỗ trợ nếu bạn cần
                  thêm thông tin.
                </Text>
              </Alert>
            ) : (
              <Timeline active={activeIndex < 0 ? 0 : activeIndex} bulletSize={22} lineWidth={2}>
                {FLOW.map((step) => (
                  <Timeline.Item key={step.status} title={step.label}>
                    <Text size="xs" c="dimmed">
                      {step.description}
                    </Text>
                  </Timeline.Item>
                ))}
              </Timeline>
            )}
          </Stack>
        </Card>

        <Button
          component={Link}
          href="/tra-hang"
          variant="default"
          leftSection={<IconArrowLeft size={16} />}
          w="fit-content"
        >
          Về trang trả hàng
        </Button>
      </Stack>
    </Container>
  );
}
