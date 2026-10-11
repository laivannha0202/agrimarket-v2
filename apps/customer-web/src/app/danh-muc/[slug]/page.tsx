import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Container } from "@mantine/core";
import { ProductCatalog } from "@/components/product/ProductCatalog";
import { ProductGridSkeleton } from "@/components/common/States";
import { resources } from "@/lib/api/resources";

/**
 * Category landing page.
 *
 * The slug is resolved against the real category list, then the catalog is
 * filtered with the real `categoryId` query param the backend supports.
 */
async function resolveCategory(slug: string) {
  try {
    const result = await resources.listCategories(100);
    return result.data.find((category) => category.slug === slug) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/danh-muc/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await resolveCategory(slug);
  return {
    title: category ? category.name : "Danh mục",
    description: category
      ? `Nông sản thuộc danh mục ${category.name} trên AgriMarket.`
      : "Danh mục nông sản trên AgriMarket.",
  };
}

export default async function CategoryPage({ params }: PageProps<"/danh-muc/[slug]">) {
  const { slug } = await params;
  const category = await resolveCategory(slug);
  if (!category) notFound();

  return (
    <Suspense
      fallback={
        <Container py="xl">
          <ProductGridSkeleton count={10} />
        </Container>
      }
    >
      <ProductCatalog lockedCategoryId={category.id} />
    </Suspense>
  );
}
