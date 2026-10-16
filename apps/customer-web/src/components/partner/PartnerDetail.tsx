"use client";

/**
 * Đối tác cung cấp — web-only screen (the app stops at the farm detail, this
 * page is reached from a farm or a product). Restyled with the app tokens so it
 * reads as part of the same shop: identity card with icon tile + info rows, the
 * partner's farms as compact link cards, then the partner's products.
 *
 * SECURITY: the partner resource also returns `bankAccountName`,
 * `bankAccountNumber`, `bankName` and `taxCode`. Those are intentionally NOT
 * rendered anywhere in the customer web — no bank details and no internal
 * financial fields reach the storefront.
 *
 * Only public identity and contact information is displayed.
 */

import { Box, Container, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import {
  IconBuildingStore,
  IconChevronRight,
  IconLeaf,
  IconMail,
  IconMapPin,
  IconPhone,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { ProductCard } from "@/components/product/ProductCard";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { EmptyState, ErrorState, NotFoundState } from "@/components/common/States";
import { AppCard, GhostButton, LoadingView } from "@/components/ui/kit";
import { layout } from "@/theme";

export function PartnerDetail({ partnerId }: { partnerId: number }) {
  const partnerQuery = useQuery({
    queryKey: queryKeys.partners.detail(partnerId),
    queryFn: () => resources.getPartner(partnerId),
  });

  const farmsQuery = useQuery({
    queryKey: queryKeys.farms.list(partnerId),
    queryFn: () => resources.listFarms(partnerId, 100),
    enabled: Number.isFinite(partnerId),
  });

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list({ page: 1, limit: 100, partnerId }),
    queryFn: () => resources.listProducts({ page: 1, limit: 100, partnerId }),
    enabled: Number.isFinite(partnerId),
  });

  const { index } = usePromotionIndex();

  if (partnerQuery.isLoading) {
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 40 }}>
        <LoadingView label="Đang tải đối tác…" />
      </Container>
    );
  }

  if (partnerQuery.isError) {
    const notFound = partnerQuery.error instanceof ApiError && partnerQuery.error.status === 404;
    return (
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }} py={{ base: 24, sm: 40 }}>
        {notFound ? (
          <NotFoundState
            title="Không tìm thấy đối tác"
            description="Đối tác có thể không còn hoạt động trên sàn."
            action={
              <GhostButton component={Link} href="/san-pham" radius={8}>
                Về danh mục sản phẩm
              </GhostButton>
            }
          />
        ) : (
          <ErrorState error={partnerQuery.error} onRetry={() => partnerQuery.refetch()} />
        )}
      </Container>
    );
  }

  const partner = partnerQuery.data;
  if (!partner) return null;

  const farms = farmsQuery.data?.data ?? [];
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
          <Text component={Link} href="/san-pham" fz={13} c="var(--agri-muted)">
            Sản phẩm
          </Text>
          <Text fz={13} c="var(--agri-muted-soft)">
            /
          </Text>
          <Text fz={13} c="var(--agri-text)" lineClamp={1} maw={240}>
            {partner.name}
          </Text>
        </Group>

        {/* Identity card */}
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
              <IconBuildingStore size={20} color="var(--agri-primary)" aria-hidden />
            </Box>
            <Text fz={17} fw={700} c="var(--agri-text-strong)" style={{ flex: 1 }}>
              {partner.name}
            </Text>
          </Group>

          <InfoRow icon={<IconUser size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            Người đại diện: {partner.representativeName}
          </InfoRow>
          <InfoRow icon={<IconMapPin size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            {partner.address}
          </InfoRow>
          <InfoRow icon={<IconPhone size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            {partner.phone}
          </InfoRow>
          <InfoRow icon={<IconMail size={15} color="var(--agri-muted-soft)" aria-hidden />}>
            {partner.email}
          </InfoRow>
        </AppCard>

        {/* Farms */}
        <AppCard padding={12}>
          <Group gap={8} align="center" wrap="nowrap" mb={8}>
            <IconLeaf size={18} color="var(--agri-primary)" aria-hidden />
            <Text fz={15} fw={700} c="var(--agri-text-strong)">
              Trang trại của đối tác
            </Text>
          </Group>

          {farmsQuery.isError ? (
            <ErrorState error={farmsQuery.error} onRetry={() => farmsQuery.refetch()} />
          ) : farmsQuery.isLoading ? (
            <LoadingView label="Đang tải trang trại…" />
          ) : farms.length === 0 ? (
            <Text fz={12.5} lh="18px" c="var(--agri-muted)">
              Đối tác chưa công khai trang trại nào.
            </Text>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing={8}>
              {farms.map((farm) => (
                <AppCard
                  key={farm.id}
                  component={Link}
                  href={`/trang-trai/${farm.id}`}
                  padding={12}
                  className="agri-press"
                >
                  <Stack gap={4}>
                    <Text fz={14} fw={600} c="var(--agri-text)" lineClamp={1}>
                      {farm.name}
                    </Text>
                    <Text fz={12.5} lh="18px" c="var(--agri-muted)" lineClamp={2}>
                      {farm.address}
                    </Text>
                    {farm.areaHa ? (
                      <Text fz={12.5} c="var(--agri-muted-soft)">
                        {farm.areaHa} ha
                      </Text>
                    ) : null}
                  </Stack>
                </AppCard>
              ))}
            </SimpleGrid>
          )}
        </AppCard>

        {/* Products */}
        <Stack gap={8}>
          <Group justify="space-between" align="center" wrap="wrap" gap={8}>
            <Text fz={15} fw={700} c="var(--agri-text-strong)">
              Sản phẩm của đối tác
            </Text>
            <GhostButton
              component={Link}
              href={`/san-pham?partnerId=${partner.id}`}
              radius={8}
              rightSection={<IconChevronRight size={14} aria-hidden />}
              styles={{ root: { minHeight: 36 }, label: { fontSize: 13, fontWeight: 600 } }}
            >
              Xem tất cả
            </GhostButton>
          </Group>

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
      <Text fz={12.5} lh="18px" c="var(--agri-muted)" style={{ flex: 1, wordBreak: "break-word" }}>
        {children}
      </Text>
    </Group>
  );
}
