"use client";

/**
 * Public certificates for a farm.
 *
 * Only `GET /certificates/farm/:farmId/valid` is used, which the backend
 * filters at read time to VERIFIED + ACTIVE + within the validity period +
 * carrying a document. The badge is deliberately "Hồ sơ đã đối chiếu" (the
 * record was checked), never a claim that AgriMarket audited the farm on site
 * or issued the certification itself.
 */

import { Box, Group, SimpleGrid, Skeleton, Stack, Text } from "@mantine/core";
import { IconCertificate, IconShieldCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate } from "@/lib/format";
import { AppCard, KVRow, ToneBadge } from "@/components/ui/kit";

export function FarmCertificates({ farmId }: { farmId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.certificates.validForFarm(farmId),
    queryFn: () => resources.listValidCertificates(farmId),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <Stack gap={8}>
        <Skeleton height={16} width={160} radius="sm" />
        <Skeleton height={72} radius={12} />
      </Stack>
    );
  }

  if (isError || (data ?? []).length === 0) {
    return (
      <AppCard padding={12}>
        <Group gap={8} wrap="nowrap" align="flex-start">
          <IconCertificate size={16} color="var(--agri-muted)" style={{ marginTop: 2 }} aria-hidden />
          <Text fz={12.5} c="var(--agri-muted)" style={{ lineHeight: 1.45 }}>
            {isError
              ? "Chưa tải được thông tin chứng nhận của trang trại này."
              : "Trang trại này hiện chưa có chứng nhận nào còn hiệu lực được công khai."}
          </Text>
        </Group>
      </AppCard>
    );
  }

  const certificates = data ?? [];

  return (
    <Stack gap={8}>
      <Group gap={6}>
        <Box c="var(--agri-primary)" style={{ display: "inline-flex" }}>
          <IconShieldCheck size={16} aria-hidden />
        </Box>
        <Text fz={13.5} fw={600}>
          Chứng nhận còn hiệu lực
        </Text>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={8}>
        {certificates.map((certificate) => (
          <AppCard key={certificate.id} padding={12}>
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Text fz={13.5} fw={700} truncate>
                  {certificate.type}
                </Text>
                <ToneBadge tone="green">Hồ sơ đã đối chiếu</ToneBadge>
              </Group>
              <KVRow label="Mã" value={certificate.certificateCode} />
              <KVRow label="Đơn vị cấp" value={certificate.issuer} />
              <KVRow
                label="Hiệu lực"
                value={`${formatDate(certificate.issuedAt)} — ${formatDate(certificate.expiresAt)}`}
              />
            </Stack>
          </AppCard>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
