import type { Metadata } from "next";
import { ProductDetail } from "@/components/product/ProductDetail";
import { resources } from "@/lib/api/resources";
import { notFound } from "next/navigation";

/** Product detail by numeric id (the backend has no by-slug lookup). */
async function loadProduct(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) return null;
  try {
    return await resources.getProduct(id);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/san-pham/[id]">): Promise<Metadata> {
  const { id } = await params;
  const product = await loadProduct(id);
  return {
    title: product?.name ?? "Sản phẩm",
    description:
      product?.description ??
      "Chi tiết nông sản, giá bán và nguồn gốc trên AgriMarket.",
  };
}

export default async function ProductDetailPage({ params }: PageProps<"/san-pham/[id]">) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) notFound();

  return <ProductDetail productId={numericId} />;
}
