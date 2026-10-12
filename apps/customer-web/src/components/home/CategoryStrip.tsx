"use client";

/**
 * Category strip.
 *
 * Categories come straight from `GET /categories` (name + slug only — the
 * backend has no category image, so none is invented).
 *
 * ICON RULE
 *
 * The glyph is chosen by the category's SLUG, never by its position in the
 * array. An index-based assignment (`ICONS[i % ICONS.length]`) is a claim about
 * the data: the moment an admin adds or reorders a category, every chip would
 * silently display a different category's picture.
 *
 * A slug without a deliberately chosen glyph gets ONE shared default glyph, so
 * every category still renders an icon and no category is ever shown with
 * another category's picture. (The initial letter is deliberately not used as a
 * fallback: a bare "R" reads as a broken image, not as a category.)
 */

import { Card, Group, SimpleGrid, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconApple,
  IconCarrot,
  IconCategory,
  IconLeaf,
  IconSalad,
  type Icon,
} from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";

/**
 * Slug -> glyph. The slug is the stable identifier of the real category row, so
 * renaming a category never detaches its glyph, and two categories can never
 * share one.
 */
const CATEGORY_ICONS: Record<string, Icon> = {
  "rau-an-la": IconSalad,
  "rau-an-qua": IconCarrot,
  "cu-qua": IconCarrot,
  "trai-cay": IconApple,
  "gao-ngu-coc": IconLeaf,
};

/** The one glyph every category without a mapped slug shares. */
export const DEFAULT_CATEGORY_ICON: Icon = IconCategory;

/** Glyph for a category slug; falls back to the shared default glyph. */
export function categoryIcon(slug: string | null | undefined): Icon {
  if (typeof slug !== "string") return DEFAULT_CATEGORY_ICON;
  return CATEGORY_ICONS[slug.trim().toLowerCase()] ?? DEFAULT_CATEGORY_ICON;
}

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
      {categories.map((category) => {
        const Icon = categoryIcon(category.slug);
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
                <Icon size={18} aria-hidden />
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
