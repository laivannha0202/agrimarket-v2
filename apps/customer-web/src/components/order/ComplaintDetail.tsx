"use client";

/**
 * Chi tiết khiếu nại — web twin of the Mobile complaint detail screen.
 *
 * Reads the caller's own complaint from `GET /complaints/me/:id`, so the status
 * and the AgriMarket resolution are always the current server state and the
 * page works after a re-login or on another device.
 *
 * The result card shows only what the backend returned: a resolution text and
 * the time it was written, or a "still processing" notice — never an invented
 * progress percentage.
 */

import { Box, Container, Group, Stack, Text } from "@mantine/core";
import {
  IconCircleCheck,
  IconClock,
  IconCube,
  IconHourglass,
  IconReceipt,
  IconTag,
} from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDateTime } from "@/lib/format";
import { complaintStatusMeta, complaintTypeLabel } from "@/lib/status";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EvidenceGallery } from "@/components/common/EvidenceGallery";
import { ErrorState, NotFoundState } from "@/components/common/States";
import { AppCard, GhostButton, LoadingView, PageTitle } from "@/components/ui/kit";
import { ApiError } from "@/lib/api/client";

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

export function ComplaintDetail({ complaintId }: { complaintId: number | null }) {
  const { data: record, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.complaints.detail(complaintId ?? 0),
    queryFn: () => resources.getMyComplaint(complaintId as number),
    enabled: complaintId !== null,
  });

  if (complaintId === null || (isError && error instanceof ApiError && error.status === 404)) {
    return (
      <Container size="md" px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 40 }}>
        <NotFoundState
          title="Không tìm thấy khiếu nại"
          description="Khiếu nại này không tồn tại hoặc không thuộc tài khoản của bạn."
          action={
            <GhostButton
              component={Link}
              href="/khieu-nai"
              radius={8}
              styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 600 } }}
            >
              Về trang khiếu nại
            </GhostButton>
          }
        />
      </Container>
    );
  }

  if (isLoading) {
    return (
      <Container size="md" px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
        <LoadingView label="Đang tải khiếu nại…" />
      </Container>
    );
  }

  if (isError || !record) {
    return (
      <Container size="md" px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
        <ErrorState error={error} onRetry={() => refetch()} title="Không tải được khiếu nại" />
      </Container>
    );
  }

  const meta = complaintStatusMeta(record.status);
  const orderLabel = record.order?.code ?? `#${record.orderId}`;

  return (
    <Container size="md" px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <Stack gap={12}>
        <PageTitle>Chi tiết khiếu nại</PageTitle>

        <AppCard>
          <Group justify="space-between" align="center" gap={8} wrap="nowrap">
            <Text fz={16} fw={700} c="var(--agri-text-strong)" truncate style={{ flex: 1 }}>
              Khiếu nại #{record.id}
            </Text>
            <StatusBadge label={meta.label} tone={meta.tone} />
          </Group>

          <InfoRow icon={<IconReceipt size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            Đơn {orderLabel}
          </InfoRow>
          {record.orderItemId ? (
            <InfoRow icon={<IconCube size={15} color="var(--agri-muted-soft)" aria-hidden />}>
              Dòng đơn #{record.orderItemId}
            </InfoRow>
          ) : null}
          <InfoRow icon={<IconTag size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            {complaintTypeLabel(record.type)}
          </InfoRow>
          <InfoRow icon={<IconClock size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            Gửi lúc {formatDateTime(record.createdAt)}
          </InfoRow>

          <Stack gap={0} mt={8} pt={8} style={{ borderTop: "1px solid var(--agri-border)" }}>
            <Text fz={12} fw={700} c="var(--agri-muted)" mb={2}>
              Nội dung
            </Text>
            <Text fz={13.5} lh="19px" c="var(--agri-text)" style={{ whiteSpace: "pre-wrap" }}>
              {record.content}
            </Text>
          </Stack>

          {/**
           * The photos attached when the complaint was filed. They are private:
           * only the owner and an ADMIN can load them, and the component
           * fetches each one with the session attached.
           */}
          <Box mt={12}>
            <EvidenceGallery images={record.evidence} label="Ảnh minh chứng đã gửi" />
          </Box>
        </AppCard>

        <AppCard>
          <SectionTitle>Kết quả xử lý</SectionTitle>
          {record.resolution ? (
            <>
              <Group gap={6} align="flex-start" wrap="nowrap">
                <IconCircleCheck
                  size={16}
                  color="var(--agri-primary)"
                  style={{ flexShrink: 0, marginTop: 2 }}
                  aria-hidden
                />
                <Text fz={13.5} lh="19px" c="var(--agri-text)" style={{ flex: 1 }}>
                  {record.resolution}
                </Text>
              </Group>
              {record.resolvedAt ? (
                <InfoRow icon={<IconClock size={15} color="var(--agri-muted-soft)" aria-hidden />}>
                  Xử lý lúc {formatDateTime(record.resolvedAt)}
                </InfoRow>
              ) : null}
            </>
          ) : (
            <Group
              gap={6}
              align="flex-start"
              wrap="nowrap"
              style={{
                background: "var(--agri-warning-soft)",
                border: "1px solid var(--agri-warning)",
                borderRadius: 8,
                padding: 8,
              }}
            >
              <IconHourglass
                size={16}
                color="var(--agri-warning)"
                style={{ flexShrink: 0, marginTop: 1 }}
                aria-hidden
              />
              <Text fz={12.5} lh="18px" style={{ flex: 1, color: "var(--agri-warning)" }}>
                AgriMarket đang xử lý khiếu nại này. Kết quả sẽ hiển thị tại đây.
              </Text>
            </Group>
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
            href="/khieu-nai"
            radius={8}
            styles={{
              root: { flex: 1, minHeight: 44, borderColor: "var(--agri-primary-border)" },
              label: { fontSize: 12.5, fontWeight: 700 },
            }}
          >
            Danh sách khiếu nại
          </GhostButton>
        </Group>

        <GhostButton
          component={Link}
          href="/khieu-nai"
          radius={8}
          styles={{ root: { minHeight: 44 }, label: { fontSize: 14, fontWeight: 700 } }}
        >
          Tạo khiếu nại mới
        </GhostButton>
      </Stack>
    </Container>
  );
}
