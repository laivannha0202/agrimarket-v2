"use client";

/**
 * Chi tiết trang trại — web twin of the Mobile `farm/[id]` screen.
 *
 * Public information only: name, address, area, coordinates, code and the valid
 * certificates. There is no QC form, no warehouse view and no audit data here —
 * those belong to the admin console.
 *
 * The related-products list is filtered by the farm's PARTNER, because the
 * catalog API supports `partnerId` but has no `farmId` filter. That is stated
 * honestly in the UI copy instead of implying a per-farm product list.
 */

import { Box, Container, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import {
  IconArrowsDiagonal,
  IconBuildingStore,
  IconLeaf,
  IconMapPin,
  IconNavigation,
  IconTag,
} from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { shortPartnerName } from "@/lib/format";
import { ProductCard } from "@/components/product/ProductCard";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { FarmCertificates } from "@/components/product/FarmCertificates";
import { EmptyState, ErrorState, NotFoundState } from "@/components/common/States";
import { AppCard, GhostButton, LoadingView } from "@/components/ui/kit";
import { layout } from "@/theme";

export function FarmDetail({ farmId }: { farmId: number }) {
  const farmQuery = useQuery({
    queryKey: queryKeys.farms.detail(farmId),
    queryFn: () => resources.getFarm(farmId),
  });

  const farm = farmQuery.data;

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list({ page: 1, limit: 100, partnerId: farm?.partnerId }),
    queryFn: () => resources.listProducts({ page: 1, limit: 100, partnerId: farm!.partnerId }),
    enabled: Boolean(farm?.partnerId),
  });

  const { index } = usePromotionIndex();

  if (farmQuery.isLoading) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 40 }}>
        <LoadingView label="Đang tải trang trại…" />
      </Container>
    );
  }

  if (farmQuery.isError) {
    const notFound = farmQuery.error instanceof ApiError && farmQuery.error.status === 404;
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 40 }}>
        {notFound ? (
          <NotFoundState
            title="Không tìm thấy trang trại"
            description="Trang trại có thể không còn hoạt động."
            action={
              <GhostButton component={Link} href="/trang-trai" radius={8}>
                Về danh sách trang trại
              </GhostButton>
            }
          />
        ) : (
          <ErrorState error={farmQuery.error} onRetry={() => farmQuery.refetch()} />
        )}
      </Container>
    );
  }

  if (!farm) return null;

  const products = (productsQuery.data?.data ?? []).slice(0, 10);

  return (
    <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 12, sm: 24 }}>
      <Stack gap={12}>
        {/* Desktop-only breadcrumb trail; the phone uses the app bar's back button. */}
        <Group gap={6} visibleFrom="sm" wrap="wrap">
          <Text component={Link} href="/" fz={13} c="var(--agri-muted)">
            Trang chủ
          </Text>
          <Text fz={13} c="var(--agri-muted-soft)">
            /
          </Text>
          <Text component={Link} href="/trang-trai" fz={13} c="var(--agri-muted)">
            Trang trại
          </Text>
          <Text fz={13} c="var(--agri-muted-soft)">
            /
          </Text>
          <Text fz={13} c="var(--agri-text)" lineClamp={1} maw={240}>
            {farm.name}
          </Text>
        </Group>

        {/* Farm identity card (Mobile head + infoRow) */}
        <AppCard padding={12}>
          <Group gap={8} align="center" wrap="nowrap" mb={8}>
            <Box
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "var(--agri-primary-soft)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <IconLeaf size={20} color="var(--agri-primary)" aria-hidden />
            </Box>
            <Stack gap={1} style={{ flex: 1 }}>
              <Text fz={17} fw={700} c="var(--agri-text-strong)">
                {farm.name}
              </Text>
              <Text fz={12.5} c="var(--agri-muted)">
                {farm.partner.name}
              </Text>
            </Stack>
          </Group>

          <InfoRow icon={<IconMapPin size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            {farm.address}
          </InfoRow>
          {farm.areaHa ? (
            <InfoRow
              icon={<IconArrowsDiagonal size={15} color="var(--agri-muted-soft)" aria-hidden />}
            >
              Diện tích {farm.areaHa} ha
            </InfoRow>
          ) : null}
          {farm.latitude && farm.longitude ? (
            <InfoRow
              icon={<IconNavigation size={15} color="var(--agri-muted-soft)" aria-hidden />}
            >
              Toạ độ {farm.latitude}, {farm.longitude}
            </InfoRow>
          ) : null}
          <InfoRow icon={<IconTag size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            Mã trang trại {farm.code}
          </InfoRow>

          {farm.description ? (
            <Text fz={14} lh="20px" c="var(--agri-text)" mt={8}>
              {farm.description}
            </Text>
          ) : null}

          <Group gap={6} justify="flex-end" mt={10}>
            <GhostButton
              component={Link}
              href={`/doi-tac/${farm.partner.id}`}
              radius={8}
              leftSection={<IconBuildingStore size={15} aria-hidden />}
              styles={{ root: { minHeight: 38 }, label: { fontSize: 13, fontWeight: 600 } }}
            >
              Xem đối tác
            </GhostButton>
          </Group>
        </AppCard>

        <FarmCertificates farmId={farm.id} />

        <Stack gap={8}>
          <Group justify="space-between" align="center" wrap="wrap" gap={8}>
            <Text fz={15} fw={700} c="var(--agri-text-strong)">
              Nông sản từ {shortPartnerName(farm.partner.name)}
            </Text>
            <GhostButton
              component={Link}
              href={`/san-pham?partnerId=${farm.partnerId}`}
              radius={8}
              styles={{ root: { minHeight: 36 }, label: { fontSize: 13, fontWeight: 600 } }}
            >
              Xem tất cả
            </GhostButton>
          </Group>

          <Text fz={12} lh="17px" c="var(--agri-muted)">
            Danh mục sản phẩm được lọc theo đối tác sở hữu trang trại.
          </Text>

          {productsQuery.isError ? (
            <ErrorState error={productsQuery.error} onRetry={() => productsQuery.refetch()} />
          ) : productsQuery.isLoading ? (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing={8}>
              {Array.from({ length: 5 }).map((_, i) => (
                <AppCard key={i} padding={0} style={{ height: 240 }} />
              ))}
            </SimpleGrid>
          ) : products.length === 0 ? (
            <EmptyState
              kind="search"
              title="Chưa có sản phẩm"
              description="Đối tác này chưa đăng bán sản phẩm nào."
            />
          ) : (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing={8}>
              {products.map((product) => (
                <ProductCard key={product.id} product={product} index={index} />
              ))}
            </SimpleGrid>
          )}
        </Stack>
      </Stack>
    </Container>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap" mt={4}>
      <Box style={{ flexShrink: 0, marginTop: 2, display: "inline-flex" }}>{icon}</Box>
      <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1 }}>
        {children}
      </Text>
    </Group>
  );
}
