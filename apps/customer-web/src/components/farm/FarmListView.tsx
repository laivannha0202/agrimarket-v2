"use client";

/**
 * Danh sách trang trại — web twin of the Mobile `farms` screen.
 *
 * Layout follows the app: a header row (icon tile + title + count), one
 * horizontal card per farm with a fallback illustration, name, address, partner
 * chip and area, then a centered note. The list is short enough (one page of
 * 100) that the app renders it whole, and this screen does the same.
 *
 * IMAGE RULE: `Farm` carries no image field in Backend V2 (only code, address,
 * coordinates, area and description), so there is no "real farm photo" to show.
 * The kit's `farm_fallback` illustration is used for every card and is
 * explicitly labelled as an illustration — it is never presented as a photo of
 * that particular farm, which is why the caption is present rather than implied.
 */

import { Box, Container, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconBuildingStore, IconChevronRight, IconLeaf, IconMapPin } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { EmptyState, ErrorState } from "@/components/common/States";
import { AppCard, LoadingView } from "@/components/ui/kit";
import { layout } from "@/theme";

export function FarmListView() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: () => resources.listFarms(undefined, 100),
    staleTime: 5 * 60_000,
  });

  const farms = data?.data ?? [];

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <Stack gap={12}>
        <Group gap={6} wrap="wrap">
          <Text component={Link} href="/" fz={13} c="var(--agri-muted)" visibleFrom="sm">
            Trang chủ
          </Text>
          <Text fz={13} c="var(--agri-muted-soft)" visibleFrom="sm">
            /
          </Text>
          <Text fz={13} c="var(--agri-text)" visibleFrom="sm">
            Trang trại
          </Text>
        </Group>

        {/* Header row (Mobile `headRow`) */}
        <Group gap={8} align="center" wrap="nowrap" mb={4}>
          <Box
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: "var(--agri-primary-soft)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <IconLeaf size={18} color="var(--agri-primary)" aria-hidden />
          </Box>
          <Stack gap={1} style={{ flex: 1 }}>
            <Text fz={16} fw={700} c="var(--agri-text-strong)">
              Trang trại đối tác
            </Text>
            <Text fz={12.5} c="var(--agri-muted)">
              {data?.meta.total ?? farms.length} trang trại đang hoạt động
            </Text>
          </Stack>
        </Group>

        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <LoadingView label="Đang tải trang trại…" />
        ) : farms.length === 0 ? (
          <EmptyState
            kind="search"
            title="Chưa có trang trại"
            description="Hệ thống chưa ghi nhận trang trại nào."
          />
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={8}>
            {farms.map((farm) => (
              <AppCard
                key={farm.id}
                component={Link}
                href={`/trang-trai/${farm.id}`}
                padding={8}
                className="agri-press"
                aria-label={`Trang trại ${farm.name}`}
              >
                <Group align="center" gap={12} wrap="nowrap">
                  <Box
                    style={{
                      width: 88,
                      height: 88,
                      borderRadius: 8,
                      overflow: "hidden",
                      background: "var(--agri-primary-soft)",
                      position: "relative",
                      flexShrink: 0,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/design/farm/farm_fallback_1000x600.png"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      className="agri-media"
                    />
                    <Box
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "rgba(15,18,15,0.55)",
                        padding: "2px 0",
                        textAlign: "center",
                      }}
                    >
                      <Text c="#ffffff" fz={9} fw={600}>
                        Hình minh hoạ
                      </Text>
                    </Box>
                  </Box>

                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Text fz={15} fw={700} lh="20px" c="var(--agri-text)" lineClamp={2}>
                      {farm.name}
                    </Text>
                    <Group gap={4} align="flex-start" wrap="nowrap">
                      <IconMapPin
                        size={13}
                        color="var(--agri-muted-soft)"
                        style={{ flexShrink: 0, marginTop: 2 }}
                        aria-hidden
                      />
                      <Text fz={12} lh="17px" c="var(--agri-muted)" lineClamp={2} style={{ flex: 1 }}>
                        {farm.address}
                      </Text>
                    </Group>
                    <Group gap={8} align="center" wrap="nowrap" mt={2}>
                      <Box
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          background: "var(--agri-primary-soft)",
                          borderRadius: 999,
                          padding: "2px 7px",
                          maxWidth: "100%",
                          minWidth: 0,
                        }}
                      >
                        <IconBuildingStore
                          size={12}
                          color="var(--agri-primary)"
                          style={{ flexShrink: 0 }}
                          aria-hidden
                        />
                        <Text
                          fz={11}
                          fw={600}
                          c="var(--agri-primary-dark)"
                          truncate
                          style={{ minWidth: 0 }}
                        >
                          {farm.partner.name}
                        </Text>
                      </Box>
                      {farm.areaHa ? (
                        <Text fz={11.5} fw={600} c="var(--agri-muted-soft)" style={{ flexShrink: 0 }}>
                          {farm.areaHa} ha
                        </Text>
                      ) : null}
                    </Group>
                  </Stack>

                  <IconChevronRight
                    size={16}
                    color="var(--agri-muted-soft)"
                    style={{ flexShrink: 0 }}
                    aria-hidden
                  />
                </Group>
              </AppCard>
            ))}
          </SimpleGrid>
        )}

        <Text fz={12} lh="17px" c="var(--agri-muted)" ta="center" mt={4}>
          Chứng nhận còn hiệu lực được hiển thị trong chi tiết từng trang trại.
        </Text>
      </Stack>
    </Container>
  );
}
