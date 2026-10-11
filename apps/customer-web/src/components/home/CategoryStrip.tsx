"use client";

/**
 * Category strip.
 *
 * Categories come straight from `GET /categories` (name + slug only — the
 * backend has no category image, so none is invented). A light generic icon is
 * used purely as decoration and is never presented as the category's image.
 */

import { Card, Group, SimpleGrid, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconApple,
  IconCarrot,
  IconLeaf,
  IconPlant2,
  IconSalad,
} from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";

const ICONS = [IconLeaf, IconApple, IconCarrot, IconSalad, IconPlant2, IconLeaf];

export function CategoryStrip() {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.categories.list(100),
    queryFn: () => resources.listCategories(100),
    staleTime: 5 * 60_000,
  });

  if (isError) return null;

  if (isLoading) {
    return (
      <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5 }} spacing="sm">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={68} radius="md" />
        ))}
      </SimpleGrid>
    );
  }

  const categories = data?.data ?? [];
  if (categories.length === 0) return null;

  return (
    <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5 }} spacing="sm">
      {categories.map((category, i) => {
        const Icon = ICONS[i % ICONS.length];
        return (
          <Card
            key={category.id}
            component={Link}
            href={`/danh-muc/${category.slug}`}
            padding="sm"
            radius="md"
            withBorder
          >
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size={34} radius="md" variant="light" color="agri">
                <Icon size={18} />
              </ThemeIcon>
              <Stack gap={0}>
                <Text size="sm" fw={600} lineClamp={2}>
                  {category.name}
                </Text>
              </Stack>
            </Group>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}
