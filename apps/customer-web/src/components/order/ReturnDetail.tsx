"use client";

/**
 * Chi tiết trả hàng — web twin of the Mobile return detail screen.
 *
 * Reads the caller's own request from `GET /returns/me/:id`, so the status is
 * always the current server state (not a stale snapshot from when it was sent)
 * and the page works after a re-login or on another device.
 *
 * The progress tracker walks `RETURN_FLOW` (the backend's happy path);
 * `REJECTED` sits off-flow, so it is drawn as its own status badge instead of
 * a half-filled tracker — exactly like the Mobile screen.
 *
 * The refund block renders only what the backend returned: an amount, a status
 * and an optional note. Nothing is invented when there is no refund yet.
 */

import { Box, Container, Group, Stack, Text } from "@mantine/core";
import { IconClock, IconCube, IconReceipt } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { returnFlowIndex, returnStatusMeta, RETURN_FLOW, type Tone } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EvidenceGallery } from "@/components/common/EvidenceGallery";
import { ErrorState, NotFoundState } from "@/components/common/States";
import { AppCard, FlowSteps, GhostButton, LoadingView, PageTitle } from "@/components/ui/kit";
import { ApiError } from "@/lib/api/client";

/** Refund status labels/tone, exactly the Mobile mapping. */
const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  COMPLETED: { label: "Đã hoàn tiền", tone: "green" },
  PENDING: { label: "Chờ hoàn tiền", tone: "yellow" },
  FAILED: { label: "Hoàn tiền thất bại", tone: "red" },
};

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap" mt={4}>
      <Box component="span" style={{ flexShrink: 0, marginTop: 2, display: "inline-flex" }}>
        {icon}
      </Box>
      <Text fz={13} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
        {children}
      </Text>
    </Group>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text fz={15} fw={700} c="var(--agri-text-strong)" mb={8}>
      {children}
    </Text>
  );
}

export function ReturnDetail({ returnId }: { returnId: number | null }) {
  const { data: record, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.returns.detail(returnId ?? 0),
    queryFn: () => resources.getMyReturn(returnId as number),
    enabled: returnId !== null,
  });

  if (returnId === null || (isError && error instanceof ApiError && error.status === 404)) {
    return (
      <Container size="md" px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 40 }}>
        <NotFoundState
          title="Không tìm thấy yêu cầu trả hàng"
          description="Yêu cầu này không tồn tại hoặc không thuộc tài khoản của bạn."
          action={
            <GhostButton
              component={Link}
              href="/tra-hang"
              radius={8}
              styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 600 } }}
            >
              Về trang trả hàng
            </GhostButton>
          }
        />
      </Container>
    );
  }

  if (isLoading) {
    return (
      <Container size="md" px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
        <LoadingView label="Đang tải yêu cầu…" />
      </Container>
    );
  }

  if (isError || !record) {
    return (
      <Container size="md" px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
        <ErrorState error={error} onRetry={() => refetch()} title="Không tải được yêu cầu" />
      </Container>
    );
  }

  const meta = returnStatusMeta(record.status);
  const currentIdx = returnFlowIndex(record.status);
  const orderLabel = record.order?.code ?? `#${record.orderId}`;
  const refundMeta = record.refund ? REFUND_STATUS[record.refund.status] : undefined;

  return (
    <Container size="md" px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <Stack gap={12}>
        <PageTitle>Chi tiết trả hàng</PageTitle>

        <AppCard>
          <Group justify="space-between" align="center" gap={8} wrap="nowrap">
            <Text fz={16} fw={700} c="var(--agri-text-strong)" truncate style={{ flex: 1 }}>
              Yêu cầu #{record.id}
            </Text>
            <StatusBadge label={meta.label} tone={meta.tone} />
          </Group>

          <InfoRow icon={<IconReceipt size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            Đơn {orderLabel}
          </InfoRow>
          <InfoRow icon={<IconCube size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            Số lượng yêu cầu trả: {formatQuantity(record.quantity)}
          </InfoRow>
          <InfoRow icon={<IconClock size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            Tạo lúc {formatDateTime(record.createdAt)}
          </InfoRow>

          <Stack
            gap={0}
            mt={8}
            pt={8}
            style={{ borderTop: "1px solid var(--agri-border)" }}
          >
            <Text fz={12} fw={700} c="var(--agri-muted)" mb={2}>
              Lý do
            </Text>
            <Text fz={13.5} lh="19px" c="var(--agri-text)">
              {record.reason}
            </Text>
          </Stack>

          {/**
           * The customer's own photos for this request, fetched with the
           * session. Only the owner (and an ADMIN) can load them.
           */}
          <Box mt={12}>
            <EvidenceGallery images={record.evidence} label="Ảnh minh chứng đã gửi" />
          </Box>
        </AppCard>

        {/* Progress through the real backend status flow (rejected is off-flow). */}
        {currentIdx >= 0 ? (
          <AppCard>
            <SectionTitle>Tiến trình xử lý</SectionTitle>
            <FlowSteps
              labels={RETURN_FLOW.map((status) => returnStatusMeta(status).label)}
              activeIndex={currentIdx}
            />
          </AppCard>
        ) : null}

        <AppCard>
          <SectionTitle>Hoàn tiền</SectionTitle>
          {record.refund ? (
            <>
              <Group justify="space-between" align="center" gap={8} wrap="nowrap" py={3}>
                <Text fz={13} c="var(--agri-muted)">
                  Số tiền hoàn
                </Text>
                <Text fz={15} fw={700} c="var(--agri-primary)">
                  {formatMoney(record.refund.amount)}
                </Text>
              </Group>
              <Group justify="space-between" align="center" gap={8} wrap="nowrap" py={3}>
                <Text fz={13} c="var(--agri-muted)">
                  Trạng thái
                </Text>
                <StatusBadge
                  label={refundMeta?.label ?? record.refund.status}
                  tone={refundMeta?.tone ?? "gray"}
                />
              </Group>
              {record.refund.reason ? (
                <Text fz={12.5} lh="18px" c="var(--agri-muted)" mt={4}>
                  Ghi chú: {record.refund.reason}
                </Text>
              ) : null}
            </>
          ) : (
            <Text fz={12.5} lh="18px" c="var(--agri-muted)">
              Chưa có thông tin hoàn tiền cho yêu cầu này.
            </Text>
          )}
        </AppCard>

        {/* Post-submit navigation: back to the order it came from or the list. */}
        <Group gap={8} mt={4} wrap="nowrap">
          <GhostButton
            component={Link}
            href={`/don-hang/${record.orderId}`}
            radius={8}
            leftSection={<IconReceipt size={15} aria-hidden />}
            styles={{
              root: { flex: 1, minHeight: 44, borderColor: "var(--agri-primary-border)" },
              label: { fontSize: 12.5, fontWeight: 700 },
            }}
          >
            Về đơn {orderLabel}
          </GhostButton>
          <GhostButton
            component={Link}
            href="/tra-hang"
            radius={8}
            styles={{
              root: { flex: 1, minHeight: 44, borderColor: "var(--agri-primary-border)" },
              label: { fontSize: 12.5, fontWeight: 700 },
            }}
          >
            Danh sách trả hàng
          </GhostButton>
        </Group>

        <GhostButton
          component={Link}
          href="/tra-hang"
          radius={8}
          styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 700 } }}
        >
          Tạo yêu cầu trả hàng mới
        </GhostButton>
      </Stack>
    </Container>
  );
}
