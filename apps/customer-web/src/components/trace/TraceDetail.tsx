"use client";

/**
 * Chi tiết truy xuất — web twin of the Mobile `trace/[code]` screen.
 *
 * One screen serves all three entry points: a manually typed code, a pasted
 * trace link, and the trace link on a purchased order item.
 *
 * The code is normalised with the shared `parseTraceCode` before the lookup
 * runs (the backend matches exactly), so a hand-typed lowercase or a full URL
 * works and a malformed value gets its own screen instead of an API error.
 *
 * Only public, backend-provided fields are rendered. Internal UUIDs, bank
 * accounts, audit records and non-public events are never exposed (the backend
 * already filters `isPublic`, and this component adds no extra data of its own).
 */

import { Box, Container, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import {
  IconBasket,
  IconBuildingStore,
  IconCalendarStats,
  IconCertificate,
  IconCircleCheck,
  IconCircleX,
  IconLeaf,
  IconShieldCheck,
} from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import {
  farmingEventLabel,
  lotStatusMeta,
  seasonStatusLabel,
  traceEventLabel,
} from "@/lib/status";
import { parseTraceCode } from "@/lib/trace-code";
import { ProductImage } from "@/components/common/ProductImage";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState, NotFoundState } from "@/components/common/States";
import { AppCard, GhostButton, KVRow, LoadingView, ToneBadge } from "@/components/ui/kit";
import { layout } from "@/theme";

const QC_CHECKS: {
  key: "appearancePassed" | "freshnessPassed" | "packagingPassed" | "damagePassed";
  label: string;
}[] = [
  { key: "appearancePassed", label: "Ngoại quan" },
  { key: "freshnessPassed", label: "Độ tươi" },
  { key: "packagingPassed", label: "Bao bì" },
  { key: "damagePassed", label: "Không hư hỏng" },
];

export function TraceDetail({ traceCode }: { traceCode: string }) {
  const parsedCode = parseTraceCode(traceCode);
  const queryCode = parsedCode ?? traceCode;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.trace.detail(queryCode),
    queryFn: () => resources.getTrace(queryCode),
    enabled: parsedCode !== null,
    retry: false,
  });

  if (!parsedCode) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 40 }}>
        <NotFoundState
          title="Mã truy xuất không hợp lệ"
          description="Vui lòng kiểm tra lại mã in trên tem. Mã có dạng TRC-000001-XXXX."
          action={
            <GhostButton component={Link} href="/truy-xuat" radius={8}>
              Nhập mã khác
            </GhostButton>
          }
        />
      </Container>
    );
  }

  if (isLoading) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 40 }}>
        <LoadingView label="Đang tra cứu hồ sơ lô hàng…" />
      </Container>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 40 }}>
        {notFound ? (
          <NotFoundState
            title="Không tìm thấy thông tin truy xuất"
            description="Mã truy xuất không tồn tại hoặc đã bị thu hồi. Vui lòng kiểm tra lại mã in trên tem."
            action={
              <GhostButton component={Link} href="/truy-xuat" radius={8}>
                Nhập mã khác
              </GhostButton>
            }
          />
        ) : (
          <Stack gap={12}>
            <ErrorState error={error} onRetry={() => refetch()} />
            <GhostButton component={Link} href="/truy-xuat" radius={8}>
              Nhập mã khác
            </GhostButton>
          </Stack>
        )}
      </Container>
    );
  }

  if (!data) return null;

  const { lot, product, partner, farm, season, harvest, qualityControl, certificates } = data;
  const lotMeta = lotStatusMeta(lot.status);
  const events = [...data.traceEvents].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  const farming = [...data.farmingEvents].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <Stack gap={12}>
        <BreadcrumbsRow traceCode={lot.traceCode} />

        {/* Hero: the real product photo when the backend has one; `ProductImage`
            falls back to the same neutral leaf placeholder the app shows. */}
        <AppCard padding={12}>
          <Group align="flex-start" gap={12} wrap="nowrap">
            <Box w={88} style={{ flexShrink: 0 }}>
              <ProductImage src={product.images[0] ?? null} alt={product.name} ratio={1} radius={8} />
            </Box>
            <Stack gap={2} justify="center" style={{ flex: 1 }}>
              <Text fz={16} fw={700} lh="21px" c="var(--agri-text-strong)" lineClamp={2}>
                {product.name}
              </Text>
              <Text fz={12.5} c="var(--agri-muted)">
                {product.category}
              </Text>
              <Group gap={6} wrap="wrap" mt={2}>
                <StatusBadge label={lotMeta.label} tone={lotMeta.tone} />
                {lot.isExpired ? <ToneBadge tone="red">Quá hạn</ToneBadge> : null}
                <ToneBadge tone="gray">Hạng {lot.grade}</ToneBadge>
              </Group>
            </Stack>
          </Group>
        </AppCard>

        {/* Lot identity + expiry */}
        <AppCard padding={12}>
          <SectionTitle>Thông tin lô</SectionTitle>
          <Stack gap={4}>
            <KVRow label="Mã lô" value={lot.code} />
            <KVRow label="Mã truy xuất" value={lot.traceCode} />
            <KVRow label="Đóng gói" value={formatDate(lot.packedAt)} />
            <KVRow
              label="Hạn dùng"
              value={formatDate(lot.expiresAt)}
              valueColor={lot.isExpired ? "var(--agri-danger)" : undefined}
            />
            <KVRow label="Còn lại" value={formatQuantity(lot.remainingQuantity, lot.unit)} />
          </Stack>
        </AppCard>

        {/* Origin chain */}
        <AppCard padding={12}>
          <SectionTitle>Nguồn gốc</SectionTitle>

          <IconRow icon={<IconLeaf size={18} color="var(--agri-primary)" />} title={farm.name}>
            <Text fz={12.5} lh="18px" c="var(--agri-muted)">
              {farm.address}
            </Text>
            {farm.areaHa ? (
              <Text fz={12.5} lh="18px" c="var(--agri-muted)">
                Diện tích {formatQuantity(farm.areaHa, "ha")}
              </Text>
            ) : null}
          </IconRow>

          <IconRow
            icon={<IconBuildingStore size={18} color="var(--agri-primary)" />}
            title={partner.name}
          >
            <Text fz={12.5} lh="18px" c="var(--agri-muted)">
              Đại diện: {partner.representativeName}
            </Text>
          </IconRow>

          <IconRow
            icon={<IconCalendarStats size={18} color="var(--agri-primary)" />}
            title={`${season.cropName}${season.variety ? ` · ${season.variety}` : ""}`}
          >
            <Text fz={12.5} lh="18px" c="var(--agri-muted)">
              Gieo {formatDate(season.plantingDate)} · Dự kiến thu{" "}
              {formatDate(season.expectedHarvestDate)}
            </Text>
            <Text fz={12.5} lh="18px" c="var(--agri-muted)">
              Trạng thái vụ: {seasonStatusLabel(season.status)}
            </Text>
          </IconRow>

          <IconRow
            icon={<IconBasket size={18} color="var(--agri-primary)" />}
            title={`Thu hoạch ${formatDate(harvest.harvestDate)}`}
          >
            <Text fz={12.5} lh="18px" c="var(--agri-muted)">
              {formatQuantity(harvest.quantity, harvest.unit)} · Hạng {harvest.grade}
            </Text>
          </IconRow>
        </AppCard>

        {/* Quality control */}
        <AppCard padding={12}>
          <SectionTitle>Kiểm định chất lượng</SectionTitle>
          {qualityControl ? (
            <>
              <Group justify="space-between" align="center" gap={8} mb={8}>
                <ToneBadge tone={qualityControl.result === "PASS" ? "green" : "red"}>
                  {qualityControl.result === "PASS" ? "Đạt" : "Không đạt"}
                </ToneBadge>
                <Text fz={12.5} c="var(--agri-muted)">
                  {formatDateTime(qualityControl.inspectedAt)}
                </Text>
              </Group>
              <SimpleGrid cols={2} spacing={8} verticalSpacing={8}>
                {QC_CHECKS.map((check) => {
                  const ok = qualityControl[check.key];
                  return (
                    <Group key={check.key} gap={6} wrap="nowrap">
                      {ok ? (
                        <IconCircleCheck
                          size={16}
                          color="var(--agri-primary)"
                          style={{ flexShrink: 0 }}
                          aria-hidden
                        />
                      ) : (
                        <IconCircleX
                          size={16}
                          color="var(--agri-danger)"
                          style={{ flexShrink: 0 }}
                          aria-hidden
                        />
                      )}
                      <Text fz={13} c="var(--agri-text)">
                        {check.label}
                      </Text>
                    </Group>
                  );
                })}
              </SimpleGrid>
            </>
          ) : (
            <Text fz={12.5} lh="18px" c="var(--agri-muted)">
              Lô hàng chưa có kết quả kiểm định.
            </Text>
          )}
        </AppCard>

        {/* Certificates */}
        {certificates.length > 0 ? (
          <AppCard padding={12}>
            <SectionTitle>Chứng nhận ({certificates.length})</SectionTitle>
            {certificates.map((certificate) => (
              <Group key={certificate.certificateCode} gap={8} align="flex-start" wrap="nowrap" py={6}>
                <Box style={iconBoxStyle}>
                  <IconCertificate size={18} color="var(--agri-primary)" aria-hidden />
                </Box>
                <Stack gap={1} style={{ flex: 1 }}>
                  <Group gap={6} wrap="wrap">
                    <Text fz={14} fw={600} lh="19px" c="var(--agri-text)">
                      {certificate.type}
                    </Text>
                    {/* "Hồ sơ đã đối chiếu" is what the system actually checked
                        (the certificate record exists, is active, within
                        validity and carries a document). It must not claim a
                        site audit that never happened. */}
                    <ToneBadge tone="green">Hồ sơ đã đối chiếu</ToneBadge>
                  </Group>
                  <Text fz={12.5} lh="18px" c="var(--agri-muted)">
                    {certificate.certificateCode} · {certificate.issuer}
                  </Text>
                  <Text fz={12.5} lh="18px" c="var(--agri-muted)">
                    Cấp {formatDate(certificate.issuedAt)} · Hết hạn{" "}
                    {formatDate(certificate.expiresAt)}
                  </Text>
                </Stack>
              </Group>
            ))}
          </AppCard>
        ) : null}

        {/* Farming events */}
        {farming.length > 0 ? (
          <AppCard padding={12}>
            <SectionTitle>Quá trình canh tác ({farming.length})</SectionTitle>
            {farming.map((event, index) => (
              <TimelineRow
                key={`${event.type}-${index}`}
                title={farmingEventLabel(event.type)}
                meta={formatDate(event.occurredAt)}
                description={event.content}
                showLine={index < farming.length - 1}
              />
            ))}
          </AppCard>
        ) : null}

        {/* Trace events */}
        <AppCard padding={12}>
          <SectionTitle>Hành trình lô hàng</SectionTitle>
          {events.length === 0 ? (
            <Text fz={12.5} lh="18px" c="var(--agri-muted)">
              Chưa có sự kiện hành trình.
            </Text>
          ) : (
            events.map((event, index) => (
              <TimelineRow
                key={`${event.type}-${index}`}
                primary
                title={traceEventLabel(event.type)}
                meta={`${formatDateTime(event.occurredAt)}${event.location ? ` · ${event.location}` : ""}`}
                description={event.description ?? undefined}
                showLine={index < events.length - 1}
              />
            ))
          )}
        </AppCard>

        {product.description ? (
          <AppCard padding={12}>
            <SectionTitle>Giới thiệu sản phẩm</SectionTitle>
            <Text fz={13} lh="19px" c="var(--agri-text)">
              {product.description}
            </Text>
          </AppCard>
        ) : null}

        <AppCard
          padding={12}
          style={{ background: "var(--agri-primary-soft)", borderColor: "var(--agri-primary-border)" }}
        >
          <Group gap={8} align="flex-start" wrap="nowrap">
            <IconShieldCheck size={18} color="var(--agri-primary)" style={{ flexShrink: 0 }} aria-hidden />
            <Text fz={12} lh="18px" c="var(--agri-text)" style={{ flex: 1 }}>
              Hồ sơ truy xuất do AgriMarket cung cấp theo dữ liệu ghi nhận của đơn vị sản xuất.
              AgriMarket không tự xác minh ngoài thực địa.
            </Text>
          </Group>
        </AppCard>
      </Stack>
    </Container>
  );
}

/** Desktop-only breadcrumb trail; the phone uses the app bar's back button. */
function BreadcrumbsRow({ traceCode }: { traceCode: string }) {
  return (
    <Group gap={6} visibleFrom="sm" wrap="wrap">
      <Text component={Link} href="/" fz={13} c="var(--agri-muted)">
        Trang chủ
      </Text>
      <Text fz={13} c="var(--agri-muted-soft)">
        /
      </Text>
      <Text component={Link} href="/truy-xuat" fz={13} c="var(--agri-muted)">
        Truy xuất nguồn gốc
      </Text>
      <Text fz={13} c="var(--agri-muted-soft)">
        /
      </Text>
      <Text fz={13} c="var(--agri-text)">
        {traceCode}
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

const iconBoxStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  background: "var(--agri-primary-soft)",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};

function IconRow({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Group gap={8} align="flex-start" wrap="nowrap" py={6}>
      <Box style={iconBoxStyle}>{icon}</Box>
      <Stack gap={1} style={{ flex: 1 }}>
        <Text fz={14} fw={600} lh="19px" c="var(--agri-text)">
          {title}
        </Text>
        {children}
      </Stack>
    </Group>
  );
}

/** Dot-and-rail timeline row (Mobile `timelineRow`). */
function TimelineRow({
  title,
  meta,
  description,
  primary = false,
  showLine,
}: {
  title: string;
  meta: string;
  description?: string;
  primary?: boolean;
  showLine: boolean;
}) {
  return (
    <Group gap={8} align="stretch" wrap="nowrap">
      <Stack
        align="center"
        gap={0}
        w={14}
        style={{ paddingTop: 5, flexShrink: 0 }}
      >
        <Box
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: primary ? "var(--agri-primary)" : "var(--agri-border-strong)",
            flexShrink: 0,
          }}
        />
        {showLine ? (
          <Box style={{ flex: 1, width: 2, background: "var(--agri-border)", marginTop: 2 }} />
        ) : null}
      </Stack>
      <Stack gap={1} pb={12} style={{ flex: 1 }}>
        <Text fz={14} fw={600} lh="19px" c="var(--agri-text)">
          {title}
        </Text>
        <Text fz={12.5} lh="18px" c="var(--agri-muted)">
          {meta}
        </Text>
        {description ? (
          <Text fz={13} lh="19px" c="var(--agri-text)">
            {description}
          </Text>
        ) : null}
      </Stack>
    </Group>
  );
}
