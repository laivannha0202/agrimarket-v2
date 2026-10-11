"use client";

/**
 * Farm detail.
 *
 * Public information only: name, address, area, description, partner and the
 * valid certificates. There is no QC form, no warehouse view and no audit data
 * here — those belong to the admin console.
 *
 * The related-products list is filtered by the farm's PARTNER, because the
 * catalog API supports `partnerId` but has no `farmId` filter. That is stated
 * honestly in the UI copy instead of implying a per-farm product list.
 */

import {
  Breadcrumbs,
  Button,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconBuildingStore, IconLeaf, IconMapPin } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { shortPartnerName } from "@/lib/format";
import { ProductCard } from "@/components/product/ProductCard";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import { FarmCertificates } from "@/components/product/FarmCertificates";
import {
  DetailSkeleton,
  EmptyState,
  ErrorState,
  NotFoundState,
} from "@/components/common/States";
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
      <Container size={layout.containerSize} py="xl">
        <DetailSkeleton />
      </Container>
    );
  }

  if (farmQuery.isError) {
    const notFound = farmQuery.error instanceof ApiError && farmQuery.error.status === 404;
    return (
      <Container size={layout.containerSize} py="xl">
        {notFound ? (
          <NotFoundState
            title="Không tìm thấy trang trại"
            description="Trang trại có thể không còn hoạt động."
            action={
              <Button component={Link} href="/trang-trai" variant="default">
                Về danh sách trang trại
              </Button>
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
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text component={Link} href="/trang-trai" size="sm" c="dimmed">
            Trang trại
          </Text>
          <Text size="sm" lineClamp={1} maw={240}>
            {farm.name}
          </Text>
        </Breadcrumbs>

        <Card padding="lg" radius="md" withBorder>
          <Stack gap="md">
            <Group gap="sm">
              <IconLeaf size={24} color="var(--mantine-color-agri-8)" />
              <Title order={2}>{farm.name}</Title>
            </Group>

            <Group gap={6} wrap="nowrap" align="flex-start">
              <IconMapPin size={17} color="#868e96" style={{ marginTop: 2, flexShrink: 0 }} />
              <Text size="sm" c="dimmed">
                {farm.address}
              </Text>
            </Group>

            {farm.areaHa ? (
              <Text size="sm" c="dimmed">
                Diện tích canh tác: {Number(farm.areaHa).toLocaleString("vi-VN")} ha
              </Text>
            ) : null}

            {farm.description ? <Text size="sm">{farm.description}</Text> : null}

            <Divider />

            <Group justify="space-between" align="center" wrap="wrap">
              <Group gap="sm">
                <IconBuildingStore size={18} color="var(--mantine-color-agri-8)" />
                <Text size="sm">
                  Đối tác: <strong>{farm.partner.name}</strong>
                </Text>
              </Group>
              <Button
                component={Link}
                href={`/doi-tac/${farm.partner.id}`}
                variant="light"
                size="xs"
              >
                Xem đối tác
              </Button>
            </Group>
          </Stack>
        </Card>

        <Card padding="lg" radius="md" withBorder>
          <FarmCertificates farmId={farm.id} />
        </Card>

        <Stack gap="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <Title order={3}>Nông sản từ {shortPartnerName(farm.partner.name)}</Title>
            <Button
              component={Link}
              href={`/san-pham?partnerId=${farm.partnerId}`}
              variant="subtle"
              size="sm"
            >
              Xem tất cả
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            Danh mục sản phẩm được lọc theo đối tác sở hữu trang trại.
          </Text>

          {productsQuery.isError ? (
            <ErrorState error={productsQuery.error} onRetry={() => productsQuery.refetch()} />
          ) : productsQuery.isLoading ? (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
              {Array.from({ length: 5 }).map((_, i) => (
                <Card key={i} padding={0} radius="md" withBorder h={240} />
              ))}
            </SimpleGrid>
          ) : products.length === 0 ? (
            <EmptyState
              title="Chưa có sản phẩm"
              description="Đối tác này chưa đăng bán sản phẩm nào."
            />
          ) : (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
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
