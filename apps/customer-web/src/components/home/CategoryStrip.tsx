"use client";

/**
 * Category strip (home page).
 *
 * Categories come straight from `GET /categories` (name + slug only — the
 * backend has no category image, so none is invented).
 *
 * GLYPH RULE
 *
 * The picture is chosen by the category's SLUG, never by its position in the
 * array: an index-based assignment would silently show a different category's
 * picture the moment an admin reorders the list. The four design glyphs shipped
 * with the Mobile app are used for the four slugs they were drawn for; every
 * other slug falls back to a shared neutral icon — never to another category's
 * picture and never to a bare letter.
 */

import { Box, Group, Image, SimpleGrid, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconCarrot,
  IconCategory,
  IconLeaf,
  type Icon,
} from "@tabler/icons-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { AppCard, SectionHeader } from "@/components/ui/kit";

/** Slug -> bundled design glyph (same files the Mobile app ships). */
const CATEGORY_IMAGES: Record<string, string> = {
  "rau-an-la": "/design/categories/category_rau_la_256.png",
  "trai-cay": "/design/categories/category_trai_cay_256.png",
  "cu-qua": "/design/categories/category_cu_qua_256.png",
  "gao-ngu-coc": "/design/categories/category_nau_san_256.png",
};

/** Slug -> neutral line icon, used when the slug has no design glyph. */
const CATEGORY_ICONS: Record<string, Icon> = {
  "rau-an-qua": IconCarrot,
  "thit-trung": IconLeaf,
};

/** The one glyph every category without a mapped slug shares. */
export const DEFAULT_CATEGORY_ICON: Icon = IconCategory;

/** Glyph for a category slug; falls back to the shared default glyph. */
export function categoryIcon(slug: string | null | undefined): Icon {
  if (typeof slug !== "string") return DEFAULT_CATEGORY_ICON;
  return CATEGORY_ICONS[slug.trim().toLowerCase()] ?? DEFAULT_CATEGORY_ICON;
}

function categoryImage(slug: string | null | undefined): string | null {
  if (typeof slug !== "string") return null;
  return CATEGORY_IMAGES[slug.trim().toLowerCase()] ?? null;
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
      <Stack gap={0}>
        <SectionHeader title="Danh mục" href="/san-pham" />
        <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5 }} spacing={8}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={62} radius={12} />
          ))}
        </SimpleGrid>
      </Stack>
    );
  }

  const categories = data?.data ?? [];
  if (categories.length === 0) return null;

  return (
    <Stack gap={0}>
      <SectionHeader title="Danh mục" href="/san-pham" />
      <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5 }} spacing={8}>
        {categories.map((category) => {
          const art = categoryImage(category.slug);
          const Icon = categoryIcon(category.slug);
          return (
            <AppCard
              key={category.id}
              component={Link}
              href={`/danh-muc/${category.slug}`}
              padding={10}
              style={{ display: "flex", alignItems: "center" }}
            >
              <Group gap={10} wrap="nowrap" align="center" w="100%">
                {art ? (
                  <Image
                    src={art}
                    alt=""
                    aria-hidden
                    w={40}
                    h={40}
                    radius={999}
                    style={{ flexShrink: 0 }}
                  />
                ) : (
                  <ThemeIcon size={40} radius={999} variant="light" color="agri" style={{ flexShrink: 0 }}>
                    <Icon size={20} aria-hidden />
                  </ThemeIcon>
                )}
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text fz={13} fw={600} lineClamp={2} lh={1.3}>
                    {category.name}
                  </Text>
                </Box>
              </Group>
            </AppCard>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
