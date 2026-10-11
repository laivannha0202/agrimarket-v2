"use client";

/** Farm directory: real public farm resource. */

import {
  Badge,
  Breadcrumbs,
  Card,
  Container,
  Group,
  Pagination,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconMapPin } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { shortPartnerName } from "@/lib/format";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/States";
import { layout } from "@/theme";

const PAGE_SIZE = 12;

export default function FarmsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...queryKeys.farms.list(), page],
    queryFn: () => resources.listFarms(undefined, 100),
    staleTime: 5 * 60_000,
  });

  const farms = data?.data ?? [];
  const totalPages = Math.ceil(farms.length / PAGE_SIZE);
  const pageItems = farms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Container size={layout.containerSize} px={{ base: "md", sm: "lg" }} py={{ base: 20, sm: 28 }}>
      <Stack gap="lg">
        <Breadcrumbs separator="/" visibleFrom="sm">
          <Text component={Link} href="/" size="sm" c="dimmed">
            Trang chủ
          </Text>
          <Text size="sm">Trang trại</Text>
        </Breadcrumbs>

        <Stack gap={4}>
          <Title order={2}>Trang trại & vùng trồng</Title>
          <Text size="sm" c="dimmed">
            Các trang trại liên kết đang cung cấp nông sản cho AgriMarket.
          </Text>
        </Stack>

        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={6} />
        ) : farms.length === 0 ? (
          <EmptyState
            title="Chưa có trang trại"
            description="Danh sách trang trại sẽ hiển thị khi có dữ liệu."
          />
        ) : (
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
              {pageItems.map((farm) => (
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
                      <IconMapPin
                        size={15}
                        color="#868e96"
                        style={{ marginTop: 2, flexShrink: 0 }}
                      />
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

            {totalPages > 1 ? (
              <Group justify="center">
                <Pagination
                  total={totalPages}
                  value={page}
                  onChange={(value) => {
                    setPage(value);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              </Group>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
