"use client";

/**
 * Trace detail.
 *
 * One screen serves all three entry points: a manually typed code, a QR link
 * from a printed label, and the trace link on a purchased order item.
 *
 * Only public, backend-provided fields are rendered. Internal UUIDs, bank
 * accounts, audit records and non-public events are never exposed (the backend
 * already filters `isPublic`, and this component adds no extra data of its own).
 */

import {
  Alert,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Timeline,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBuildingStore,
  IconCalendarStats,
  IconCertificate,
  IconCheck,
  IconLeaf,
  IconMapPin,
  IconPackage,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import { farmingEventLabel, lotStatusMeta, traceEventLabel } from "@/lib/status";
import { ProductImage } from "@/components/common/ProductImage";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState, NotFoundState, DetailSkeleton } from "@/components/common/States";
import { layout } from "@/theme";

export function TraceDetail({ traceCode }: { traceCode: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.trace.detail(traceCode),
    queryFn: () => resources.getTrace(traceCode),
    retry: false,
  });

  if (isLoading) {
    return (
      <Container size={layout.containerSize} py="xl">
        <DetailSkeleton />
      </Container>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Container size={layout.containerSize} py="xl">
        {notFound ? (
          <NotFoundState
            title="Không tìm thấy thông tin truy xuất"
            description="Mã truy xuất không tồn tại hoặc đã bị thu hồi. Vui lòng kiểm tra lại mã in trên tem."
            action={
              <Button component={Link} href="/truy-xuat" variant="default">
                Nhập mã khác
              </Button>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={() => refetch()} />
        )}
      </Container>
    );
  }

  if (!data) return null;

  const { lot, product, partner, farm, season, harvest, qualityControl, certificates } = data;
  const isRecalled = lot.status === "RECALLED";
  const isExpired = lot.isExpired;
  const lotMeta = lotStatusMeta(lot.status);

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text component={Link} href="/truy-xuat" size="sm" c="dimmed">
            Truy xuất nguồn gốc
          </Text>
          <Text size="sm">{lot.traceCode}</Text>
        </Breadcrumbs>

        {isRecalled ? (
          <Alert
            color="red"
            variant="filled"
            icon={<IconAlertTriangle size={20} />}
            title="Lô hàng này đã bị thu hồi"
          >
            <Text size="sm">
              Lô {lot.code} đã được đánh dấu thu hồi và không còn được bán. Nếu bạn đã mua
              sản phẩm thuộc lô này, vui lòng liên hệ bộ phận chăm sóc khách hàng hoặc tạo
              khiếu nại trong chi tiết đơn hàng.
            </Text>
          </Alert>
        ) : isExpired ? (
          <Alert
            color="orange"
            variant="light"
            icon={<IconAlertTriangle size={20} />}
            title="Lô hàng đã hết hạn sử dụng"
          >
            <Text size="sm">
              Lô {lot.code} đã quá hạn sử dụng ghi trên tem ({formatDate(lot.expiresAt)}) và
              không còn được phân bổ để bán.
            </Text>
          </Alert>
        ) : null}

        {/* Product header */}
        <Card padding="lg" radius="md" withBorder>
          <Group align="flex-start" gap="lg" wrap="wrap">
            <Box w={120} style={{ flexShrink: 0 }}>
              <ProductImage
                src={product.images[0] ?? null}
                alt={product.name}
                ratio={1}
                radius={8}
                fallbackLabel={product.name}
              />
            </Box>

            <Stack gap="xs" style={{ flex: 1, minWidth: 240 }}>
              <Group gap="sm" wrap="wrap">
                <Title order={2} fz={{ base: 22, sm: 28 }}>
                  {product.name}
                </Title>
                <StatusBadge label={lotMeta.label} tone={lotMeta.tone} />
              </Group>
              <Text size="sm" c="dimmed">
                {product.category}
              </Text>
              {product.description ? (
                <Text size="sm" c="dimmed">
                  {product.description}
                </Text>
              ) : null}
              <Group gap="xs" wrap="wrap">
                <Badge variant="light" color="gray" radius="sm">
                  Mã lô: {lot.code}
                </Badge>
                <Badge variant="light" color="gray" radius="sm">
                  Mã truy xuất: {lot.traceCode}
                </Badge>
              </Group>
              {!isRecalled ? (
                <Button
                  component={Link}
                  href={`/san-pham?search=${encodeURIComponent(product.name)}`}
                  variant="light"
                  size="xs"
                  w="fit-content"
                >
                  Tìm sản phẩm này
                </Button>
              ) : null}
            </Stack>
          </Group>
        </Card>

        {/* Origin chain */}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          <InfoCard
            icon={<IconLeaf size={18} color="var(--mantine-color-agri-8)" />}
            title="Vụ mùa"
          >
            <InfoRow label="Cây trồng" value={season.cropName} />
            {season.variety ? <InfoRow label="Giống" value={season.variety} /> : null}
            <InfoRow label="Ngày trồng" value={formatDate(season.plantingDate)} />
            <InfoRow label="Dự kiến thu hoạch" value={formatDate(season.expectedHarvestDate)} />
          </InfoCard>

          <InfoCard
            icon={<IconCalendarStats size={18} color="var(--mantine-color-agri-8)" />}
            title="Thu hoạch"
          >
            <InfoRow label="Ngày thu hoạch" value={formatDate(harvest.harvestDate)} />
            <InfoRow
              label="Sản lượng"
              value={formatQuantity(harvest.quantity, harvest.unit)}
            />
            <InfoRow label="Phân loại" value={harvest.grade} />
            {lot.packedAt ? (
              <InfoRow label="Ngày đóng gói" value={formatDate(lot.packedAt)} />
            ) : null}
            <InfoRow label="Hạn sử dụng" value={formatDate(lot.expiresAt)} />
          </InfoCard>

          <InfoCard
            icon={<IconMapPin size={18} color="var(--mantine-color-agri-8)" />}
            title="Trang trại"
          >
            <InfoRow label="Tên" value={farm.name} />
            <InfoRow label="Địa chỉ" value={farm.address} />
            {farm.areaHa ? (
              <InfoRow label="Diện tích" value={`${Number(farm.areaHa).toLocaleString("vi-VN")} ha`} />
            ) : null}
            {farm.description ? <InfoRow label="Mô tả" value={farm.description} /> : null}
          </InfoCard>

          <InfoCard
            icon={<IconBuildingStore size={18} color="var(--mantine-color-agri-8)" />}
            title="Đối tác cung cấp"
          >
            <InfoRow label="Tên" value={partner.name} />
            <InfoRow label="Người đại diện" value={partner.representativeName} />
          </InfoCard>

          <InfoCard
            icon={<IconShieldCheck size={18} color="var(--mantine-color-agri-8)" />}
            title="Kiểm định chất lượng"
          >
            {qualityControl ? (
              <>
                <Group gap="xs" mb={6}>
                  <Badge
                    color={qualityControl.result === "PASS" ? "agri" : "red"}
                    variant="light"
                    radius="sm"
                  >
                    {qualityControl.result === "PASS" ? "Đạt yêu cầu" : "Không đạt"}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {formatDateTime(qualityControl.inspectedAt)}
                  </Text>
                </Group>
                <CheckRow label="Ngoại hình" ok={qualityControl.appearancePassed} />
                <CheckRow label="Độ tươi" ok={qualityControl.freshnessPassed} />
                <CheckRow label="Đóng gói" ok={qualityControl.packagingPassed} />
                <CheckRow label="Không tổn thương" ok={qualityControl.damagePassed} />
              </>
            ) : (
              <Text size="sm" c="dimmed">
                Lô hàng chưa có kết quả kiểm định được công khai.
              </Text>
            )}
          </InfoCard>

          <InfoCard
            icon={<IconCertificate size={18} color="var(--mantine-color-agri-8)" />}
            title="Chứng nhận còn hiệu lực"
          >
            {certificates.length === 0 ? (
              <Text size="sm" c="dimmed">
                Trang trại chưa có chứng nhận nào còn hiệu lực.
              </Text>
            ) : (
              <Stack gap="sm">
                {certificates.map((certificate) => (
                  <Stack key={certificate.certificateCode} gap={2}>
                    <Group gap="xs">
                      <Text size="sm" fw={700}>
                        {certificate.type}
                      </Text>
                      {/* "Hồ sơ đã đối chiếu" is what the system actually
                          checked (the certificate record exists, is active and
                          within validity). It must not claim a site audit that
                          never happened. */}
                      <Badge color="agri" variant="light" size="xs" radius="sm">
                        Hồ sơ đã đối chiếu
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Mã: {certificate.certificateCode}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Đơn vị cấp: {certificate.issuer}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Hiệu lực: {formatDate(certificate.issuedAt)} —{" "}
                      {formatDate(certificate.expiresAt)}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            )}
          </InfoCard>
        </SimpleGrid>

        {/* Timeline + farming events + lot detail */}
        <Tabs defaultValue="timeline" variant="outline">
          <Tabs.List>
            <Tabs.Tab value="timeline">Hành trình lô hàng</Tabs.Tab>
            <Tabs.Tab value="farming">Nhật ký canh tác</Tabs.Tab>
            <Tabs.Tab value="lot">Thông tin lô</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="timeline" pt="md">
            <Card padding="lg" radius="md" withBorder>
              {data.traceEvents.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Lô hàng chưa có sự kiện truy xuất nào được công khai.
                </Text>
              ) : (
                <Timeline active={data.traceEvents.length - 1} bulletSize={26} lineWidth={2}>
                  {data.traceEvents.map((event, index) => (
                    <Timeline.Item
                      key={`${event.type}-${event.occurredAt}-${index}`}
                      bullet={<IconPackage size={13} />}
                      title={traceEventLabel(event.type)}
                    >
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">
                          {formatDateTime(event.occurredAt)}
                          {event.location ? ` · ${event.location}` : ""}
                        </Text>
                        {event.description ? (
                          <Text size="sm">{event.description}</Text>
                        ) : null}
                      </Stack>
                    </Timeline.Item>
                  ))}
                </Timeline>
              )}
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value="farming" pt="md">
            <Card padding="lg" radius="md" withBorder>
              {data.farmingEvents.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Vụ mùa này chưa có nhật ký canh tác được công khai.
                </Text>
              ) : (
                <Stack gap="sm">
                  {data.farmingEvents.map((event, index) => (
                    <Box key={`${event.type}-${event.occurredAt}-${index}`}>
                      <Group justify="space-between" wrap="wrap" gap="xs">
                        <Text size="sm" fw={600}>
                          {farmingEventLabel(event.type)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {formatDate(event.occurredAt)}
                        </Text>
                      </Group>
                      <Text size="sm" c="dimmed">
                        {event.content}
                      </Text>
                      {index < data.farmingEvents.length - 1 ? <Divider mt="sm" /> : null}
                    </Box>
                  ))}
                </Stack>
              )}
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value="lot" pt="md">
            <Card padding="lg" radius="md" withBorder>
              <Table verticalSpacing="xs">
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td w={200}>
                      <Text size="sm" c="dimmed">
                        Mã lô
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{lot.code}</Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        Mã truy xuất
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{lot.traceCode}</Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        Phân loại
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{lot.grade}</Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        Số lượng lô
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatQuantity(lot.quantity, lot.unit)}</Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        Hạn sử dụng
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatDate(lot.expiresAt)}</Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        Trạng thái lô
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge label={lotMeta.label} tone={lotMeta.tone} size="sm" />
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </Card>
          </Tabs.Panel>
        </Tabs>

        <Group justify="center">
          <Button component={Link} href="/truy-xuat" variant="subtle" size="sm">
            Tra cứu mã khác
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}

function InfoCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card padding="lg" radius="md" withBorder h="100%">
      <Stack gap="xs">
        <Group gap="sm">
          <ThemeIcon size={32} radius="md" variant="light" color="agri">
            {icon}
          </ThemeIcon>
          <Text fw={700}>{title}</Text>
        </Group>
        <Stack gap={6}>{children}</Stack>
      </Stack>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Group gap="xs" wrap="wrap">
      <Text size="xs" c="dimmed" w={110} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="sm" style={{ flex: 1, minWidth: 120 }}>
        {value}
      </Text>
    </Group>
  );
}

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Group gap={8}>
      {ok ? (
        <IconCheck size={15} color="var(--mantine-color-agri-8)" />
      ) : (
        <IconX size={15} color="var(--mantine-color-red-6)" />
      )}
      <Text size="sm" c={ok ? undefined : "red.7"}>
        {label}: {ok ? "Đạt" : "Không đạt"}
      </Text>
    </Group>
  );
}
