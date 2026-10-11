"use client";

/**
 * Featured farms and the traceability CTA.
 *
 * Farm data is the real public farm resource (name, address, area, partner).
 * The CTA links to the trace lookup, the project's signature feature.
 */

import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowRight, IconMapPin, IconQrcode } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { shortPartnerName } from "@/lib/format";
import { layout } from "@/theme";
import { SectionHeader } from "@/components/home/FlashSaleSection";
import { ErrorState } from "@/components/common/States";

export function FarmsSection() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: () => resources.listFarms(undefined, 6),
    staleTime: 5 * 60_000,
  });

  if (isError) {
    return (
      <Stack gap="md">
        <SectionHeader title="Trang trại & nguồn nông sản" href="/trang-trai" />
        <ErrorState error={error} onRetry={() => refetch()} />
      </Stack>
    );
  }

  if (isLoading) {
    return (
      <Stack gap="md">
        <SectionHeader title="Trang trại & nguồn nông sản" href="/trang-trai" />
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} padding="md" radius="md" withBorder h={140} />
          ))}
        </SimpleGrid>
      </Stack>
    );
  }

  const farms = data?.data ?? [];
  if (farms.length === 0) return null;

  return (
    <Stack gap="md">
      <SectionHeader title="Trang trại & nguồn nông sản" href="/trang-trai" />
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {farms.map((farm) => (
          <Card
            key={farm.id}
            component={Link}
            href={`/trang-trai/${farm.id}`}
            padding="md"
            radius="md"
            withBorder
          >
            <Stack gap="xs">
              <Text fw={700} lineClamp={1}>
                {farm.name}
              </Text>
              <Group gap={6} wrap="nowrap" align="flex-start">
                <IconMapPin size={15} color="#868e96" style={{ marginTop: 2, flexShrink: 0 }} />
                <Text size="sm" c="dimmed" lineClamp={2}>
                  {farm.address}
                </Text>
              </Group>
              <Group gap="xs">
                <Badge variant="light" color="agri" size="sm" radius="sm">
                  {shortPartnerName(farm.partner.name)}
                </Badge>
                {farm.areaHa ? (
                  <Text size="xs" c="dimmed">
                    {Number(farm.areaHa).toLocaleString("vi-VN")} ha
                  </Text>
                ) : null}
              </Group>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export function TraceCta() {
  return (
    <Box
      py={{ base: 32, sm: 40 }}
      style={{ background: "var(--mantine-color-agri-0)" }}
    >
      <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }}>
        <Group justify="space-between" align="center" gap="xl" wrap="wrap">
          <Stack gap="xs" maw={620}>
            <Group gap="sm">
              <IconQrcode size={26} color="var(--mantine-color-agri-8)" />
              <Title order={3}>Kiểm tra nguồn gốc lô hàng</Title>
            </Group>
            <Text c="dimmed" size="sm">
              Nhập mã truy xuất in trên tem hoặc trong chi tiết đơn hàng để xem vụ mùa,
              trang trại, kết quả kiểm định chất lượng và chứng nhận còn hiệu lực.
            </Text>
          </Stack>
          <Button
            component={Link}
            href="/truy-xuat"
            size="md"
            rightSection={<IconArrowRight size={18} />}
          >
            Tra cứu ngay
          </Button>
        </Group>
      </Container>
    </Box>
  );
}
