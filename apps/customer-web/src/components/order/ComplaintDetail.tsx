"use client";

/**
 * Complaint detail.
 *
 * Reads the caller's own complaint from `GET /complaints/me/:id`, so the status
 * and the AgriMarket resolution are always the current server state and the
 * page works after a re-login or on another device.
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
import { formatDateTime } from "@/lib/format";
import { complaintStatusMeta, complaintTypeLabel } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EvidenceGallery } from "@/components/common/EvidenceGallery";
import { DetailSkeleton, ErrorState, NotFoundState } from "@/components/common/States";
import { ApiError } from "@/lib/api/client";

const FLOW: Array<{ status: string; label: string; description: string }> = [
  { status: "OPEN", label: "Đã tiếp nhận", description: "AgriMarket đã nhận khiếu nại của bạn." },
  { status: "PROCESSING", label: "Đang xử lý", description: "Bộ phận chăm sóc khách hàng đang kiểm tra." },
  { status: "RESOLVED", label: "Đã giải quyết", description: "Khiếu nại đã được xử lý xong." },
];

export function ComplaintDetail({ complaintId }: { complaintId: number | null }) {
  const { data: record, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.complaints.detail(complaintId ?? 0),
    queryFn: () => resources.getMyComplaint(complaintId as number),
    enabled: complaintId !== null,
  });

  if (complaintId === null || (isError && error instanceof ApiError && error.status === 404)) {
    return (
      <Container size="sm" px={{ base: "md", sm: "lg" }} py={{ base: 32, sm: 48 }}>
        <NotFoundState
          title="Không tìm thấy khiếu nại"
          description="Khiếu nại này không tồn tại hoặc không thuộc tài khoản của bạn."
          action={
            <Button component={Link} href="/khieu-nai">
              Về trang khiếu nại
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

  const meta = complaintStatusMeta(record.status);
  const rejected = record.status === "REJECTED";
  const activeIndex = FLOW.findIndex((step) => step.status === record.status);

  return (
    <Container size="md" px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Group justify="space-between" wrap="wrap" gap="md">
          <Stack gap={4}>
            <Title order={2}>Khiếu nại: {complaintTypeLabel(record.type)}</Title>
            <Text size="sm" c="dimmed">
              Gửi lúc {formatDateTime(record.createdAt)}
            </Text>
          </Stack>
          <StatusBadge label={meta.label} tone={meta.tone} />
        </Group>

        <Card padding="lg" radius="md" withBorder>
          <Stack gap="md">
            <Title order={4}>Nội dung khiếu nại</Title>
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
            <Stack gap={2}>
              <Text size="sm" c="dimmed">
                Nội dung
              </Text>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {record.content}
              </Text>
            </Stack>
            {/**
             * The photos attached when the complaint was filed. They are private:
             * only the owner and an ADMIN can load them, and the component
             * fetches each one with the session attached.
             */}
            <EvidenceGallery images={record.evidence} label="Ảnh minh chứng đã gửi" />
            {record.resolution ? (
              <Stack gap={2}>
                <Text size="sm" c="dimmed">
                  Phản hồi từ AgriMarket
                </Text>
                <Text size="sm">{record.resolution}</Text>
              </Stack>
            ) : null}
            {record.resolvedAt ? (
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Text size="sm" c="dimmed">
                  Thời điểm giải quyết
                </Text>
                <Text size="sm">{formatDateTime(record.resolvedAt)}</Text>
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
                  Khiếu nại đã bị từ chối. Vui lòng liên hệ bộ phận hỗ trợ nếu bạn cần thêm
                  thông tin.
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
          href="/khieu-nai"
          variant="default"
          leftSection={<IconArrowLeft size={16} />}
          w="fit-content"
        >
          Về trang khiếu nại
        </Button>
      </Stack>
    </Container>
  );
}
