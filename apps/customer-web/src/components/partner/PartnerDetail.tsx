"use client";

/**
 * Partner (supplier) page.
 *
 * SECURITY: the partner resource also returns `bankAccountName`,
 * `bankAccountNumber`, `bankName` and `taxCode`. Those are intentionally NOT
 * rendered anywhere in the customer web — no bank details and no internal
 * financial fields reach the storefront.
 *
 * Only public identity and contact information is displayed.
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
import { IconBuildingStore, IconLeaf, IconMail, IconMapPin, IconPhone, IconUser } from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { ProductCard } from "@/components/product/ProductCard";
import { usePromotionIndex } from "@/components/product/usePromotionIndex";
import {
  DetailSkeleton,
  EmptyState,
  ErrorState,
  NotFoundState,
} from "@/components/common/States";
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
      <Container size={layout.containerSize} py="xl">
        <DetailSkeleton />
      </Container>
    );
  }

  if (partnerQuery.isError) {
    const notFound = partnerQuery.error instanceof ApiError && partnerQuery.error.status === 404;
    return (
      <Container size={layout.containerSize} py="xl">
        {notFound ? (
          <NotFoundState
            title="Không tìm thấy đối tác"
            description="Đối tác có thể không còn hoạt động trên sàn."
            action={
              <Button component={Link} href="/san-pham" variant="default">
                Về danh mục sản phẩm
              </Button>
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
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text component={Link} href="/san-pham" size="sm" c="dimmed">
            Sản phẩm
          </Text>
          <Text size="sm" lineClamp={1} maw={240}>
            {partner.name}
          </Text>
        </Breadcrumbs>

        <Card padding="lg" radius="md" withBorder>
          <Stack gap="md">
            <Group gap="sm">
              <IconBuildingStore size={24} color="var(--mantine-color-agri-8)" />
              <Title order={2}>{partner.name}</Title>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <Group gap={8} wrap="nowrap" align="flex-start">
                <IconUser size={16} color="#868e96" style={{ marginTop: 2 }} />
                <Text size="sm">
                  Người đại diện: <strong>{partner.representativeName}</strong>
                </Text>
              </Group>
              <Group gap={8} wrap="nowrap" align="flex-start">
                <IconMapPin size={16} color="#868e96" style={{ marginTop: 2 }} />
                <Text size="sm" c="dimmed">
                  {partner.address}
                </Text>
              </Group>
              <Group gap={8} wrap="nowrap">
                <IconPhone size={16} color="#868e96" />
                <Text size="sm" c="dimmed">
                  {partner.phone}
                </Text>
              </Group>
              <Group gap={8} wrap="nowrap">
                <IconMail size={16} color="#868e96" />
                <Text size="sm" c="dimmed">
                  {partner.email}
                </Text>
              </Group>
            </SimpleGrid>
          </Stack>
        </Card>

        <Card padding="lg" radius="md" withBorder>
          <Stack gap="md">
            <Group gap="sm">
              <IconLeaf size={20} color="var(--mantine-color-agri-8)" />
              <Title order={4}>Trang trại của đối tác</Title>
            </Group>
            <Divider />
            {farmsQuery.isError ? (
              <ErrorState error={farmsQuery.error} onRetry={() => farmsQuery.refetch()} />
            ) : farms.length === 0 ? (
              <Text size="sm" c="dimmed">
                Đối tác chưa công khai trang trại nào.
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
                {farms.map((farm) => (
                  <Card
                    key={farm.id}
                    component={Link}
                    href={`/trang-trai/${farm.id}`}
                    padding="sm"
                    radius="md"
                    withBorder
                  >
                    <Stack gap={4}>
                      <Text size="sm" fw={600} lineClamp={1}>
                        {farm.name}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {farm.address}
                      </Text>
                      {farm.areaHa ? (
                        <Text size="xs" c="dimmed">
                          {Number(farm.areaHa).toLocaleString("vi-VN")} ha
                        </Text>
                      ) : null}
                    </Stack>
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </Stack>
        </Card>

        <Stack gap="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <Title order={3}>Sản phẩm của đối tác</Title>
            <Button
              component={Link}
              href={`/san-pham?partnerId=${partner.id}`}
              variant="subtle"
              size="sm"
            >
              Xem tất cả
            </Button>
          </Group>

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
