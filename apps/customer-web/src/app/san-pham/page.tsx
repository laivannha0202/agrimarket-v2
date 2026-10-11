import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductCatalog } from "@/components/product/ProductCatalog";
import { ProductGridSkeleton } from "@/components/common/States";
import { Container } from "@mantine/core";

export const metadata: Metadata = {
  title: "Sản phẩm",
  description: "Danh mục nông sản theo mùa từ các hợp tác xã và trang trại liên kết.",
};

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <Container py="xl">
          <ProductGridSkeleton count={10} />
        </Container>
      }
    >
      <ProductCatalog />
    </Suspense>
  );
}
