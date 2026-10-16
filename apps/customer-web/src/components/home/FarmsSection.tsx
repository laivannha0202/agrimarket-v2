"use client";

/**
 * Featured farms and the traceability CTA (home page).
 *
 * Farm data is the real public farm resource (name, address, area, partner).
 * The backend has no farm photo, so cards use the shared fallback artwork which
 * is ALWAYS tagged "Hình minh hoạ" — an illustration is never presented as a
 * verified photo of a real farm.
 */

import { Badge, Box, Container, Group, Image, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconArrowRight, IconMapPin, IconQrcode } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { shortPartnerName } from "@/lib/format";
import { layout } from "@/theme";
import { AppCard, GhostButton, SectionHeader } from "@/components/ui/kit";
import { ErrorState } from "@/components/common/States";
import type { Farm } from "@/lib/api/types";

/** 88px farm thumb with the honest "Hình minh hoạ" tag. */
export function FarmThumb({ size = 88 }: { size?: number }) {
  return (
    <Box
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <Image
        src="/design/farm/farm_fallback_1000x600.png"
        alt=""
        aria-hidden
        w={size}
        h={size}
        fit="cover"
      />
      <Box
        component="span"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(15, 18, 15, 0.55)",
          color: "#ffffff",
          fontSize: 10,
          fontWeight: 600,
          textAlign: "center",
          lineHeight: "16px",
          padding: "1px 4px",
        }}
      >
        Hình minh hoạ
      </Box>
    </Box>
  );
}

/** Compact farm row card shared by the home strip and the farm list. */
export function FarmRowCard({ farm }: { farm: Farm }) {
  return (
    <AppCard component={Link} href={`/trang-trai/${farm.id}`} padding={10}>
      <Group gap={10} wrap="nowrap" align="flex-start">
        <FarmThumb />
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text fz={14.5} fw={700} lineClamp={1}>
            {farm.name}
          </Text>
          <Group gap={5} wrap="nowrap" align="flex-start">
            <IconMapPin size={14} color="var(--agri-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
            <Text fz={12.5} c="var(--agri-muted)" lineClamp={2} style={{ lineHeight: 1.35 }}>
              {farm.address}
            </Text>
          </Group>
          <Group gap={6} wrap="nowrap">
            <Badge variant="light" color="agri" size="sm" radius={999} fw={600}>
              {shortPartnerName(farm.partner.name)}
            </Badge>
            {farm.areaHa ? (
              <Text fz={12} c="var(--agri-muted)" style={{ whiteSpace: "nowrap" }}>
                {Number(farm.areaHa).toLocaleString("vi-VN")} ha
              </Text>
            ) : null}
          </Group>
        </Stack>
      </Group>
    </AppCard>
  );
}

export function FarmsSection() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: () => resources.listFarms(undefined, 6),
    staleTime: 5 * 60_000,
  });

  if (isError) {
    return (
      <Stack gap={8}>
        <SectionHeader title="Trang trại" href="/trang-trai" />
        <ErrorState error={error} onRetry={() => refetch()} />
      </Stack>
    );
  }

  if (isLoading) {
    return (
      <Stack gap={8}>
        <SectionHeader title="Trang trại" href="/trang-trai" />
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing={8}>
          {Array.from({ length: 3 }).map((_, i) => (
            <AppCard key={i} h={110} />
          ))}
        </SimpleGrid>
      </Stack>
    );
  }

  const farms = data?.data ?? [];
  if (farms.length === 0) return null;

  return (
    <Stack gap={8}>
      <SectionHeader title="Trang trại" href="/trang-trai" />
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing={8} verticalSpacing={8}>
        {farms.map((farm) => (
          <FarmRowCard key={farm.id} farm={farm} />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export function TraceCta() {
  return (
    <Box py={{ base: 8, sm: 24 }} mt={{ base: 8, sm: 16 }}>
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }}>
        <AppCard
          p={{ base: 14, sm: 20 }}
          style={{ background: "var(--agri-primary-soft)", borderColor: "var(--agri-primary-border)" }}
        >
        <Group justify="space-between" align="center" gap="lg" wrap="wrap">
          <Group gap={14} wrap="nowrap" align="center">
            <Image
              src="/design/trace/trace_scan_illustration_640x440.png"
              alt=""
              aria-hidden
              w={96}
              h={66}
              fit="contain"
              visibleFrom="xs"
              style={{ flexShrink: 0 }}
            />
            <Stack gap={4}>
              <Group gap={8} wrap="nowrap">
                <IconQrcode size={20} color="var(--agri-primary)" />
                <Text fz={16} fw={700} c="var(--agri-text-strong)">
                  Truy xuất nguồn gốc
                </Text>
              </Group>
              <Text fz={13} c="var(--agri-muted)" maw={560} style={{ lineHeight: 1.45 }}>
                Nhập mã trên tem hoặc quét mã QR để xem trang trại, mùa vụ, kết quả kiểm
                định chất lượng của lô hàng.
              </Text>
            </Stack>
          </Group>
          <GhostButton
            component={Link}
            href="/truy-xuat"
            radius={999}
            rightSection={<IconArrowRight size={16} />}
            style={{ background: "#ffffff" }}
          >
            Tra cứu ngay
          </GhostButton>
        </Group>
        </AppCard>
      </Container>
    </Box>
  );
}
