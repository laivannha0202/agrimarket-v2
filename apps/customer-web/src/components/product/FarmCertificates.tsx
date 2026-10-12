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

import { Alert, Badge, Card, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconCertificate, IconShieldCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate } from "@/lib/format";

export function FarmCertificates({ farmId }: { farmId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.certificates.validForFarm(farmId),
    queryFn: () => resources.listValidCertificates(farmId),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return <Card padding="md" radius="md" withBorder h={90} />;
  }

  if (isError) {
    return (
      <Alert color="gray" variant="light" icon={<IconCertificate size={16} />}>
        <Text size="xs">Chưa tải được thông tin chứng nhận của trang trại này.</Text>
      </Alert>
    );
  }

  const certificates = data ?? [];

  if (certificates.length === 0) {
    return (
      <Alert color="gray" variant="light" icon={<IconCertificate size={16} />}>
        <Text size="xs">
          Trang trại này hiện chưa có chứng nhận nào còn hiệu lực được công khai.
        </Text>
      </Alert>
    );
  }

  return (
    <Stack gap="xs">
      <Group gap={6}>
        <IconShieldCheck size={16} color="var(--mantine-color-agri-8)" />
        <Text size="sm" fw={600}>
          Chứng nhận còn hiệu lực
        </Text>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        {certificates.map((certificate) => (
          <Card key={certificate.id} padding="sm" radius="md" withBorder>
            <Stack gap={4}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={700}>
                  {certificate.type}
                </Text>
                <Badge color="agri" variant="light" size="sm" radius="sm">
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
                Hiệu lực: {formatDate(certificate.issuedAt)} — {formatDate(certificate.expiresAt)}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
