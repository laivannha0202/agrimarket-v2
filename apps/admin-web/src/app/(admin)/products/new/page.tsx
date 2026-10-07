"use client";

import { useRouter } from "next/navigation";
import { Button, Form } from "antd";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { ProductFormFields } from "@/components/product/ProductFormFields";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import type { Product } from "@/types/api";

interface VariantForm {
  sku: string;
  name: string;
  saleUnit: string;
  basePrice: number;
}

interface ProductForm {
  name: string;
  slug: string;
  partnerId: number;
  categoryId: number;
  farmId?: number;
  description?: string;
  status: string;
  variants?: VariantForm[];
}

export default function NewProductPage() {
  const router = useRouter();
  const [form] = Form.useForm<ProductForm>();

  const create = useAction(
    (values: ProductForm) =>
      resources.createProduct({
        ...values,
        variants: values.variants?.map((v) => ({
          ...v,
          basePrice: Number(v.basePrice),
        })),
      }),
    {
      invalidate: [["products"]],
      successMessage: "Đã tạo sản phẩm.",
      onSuccess: (created: Product) => router.replace(`/products/${created.id}`),
    },
  );

  return (
    <DetailPage
      title="Thêm sản phẩm"
      subtitle="Tạo sản phẩm mới kèm biến thể"
      backHref="/products"
      backLabel="Danh sách sản phẩm"
    >
      <DetailCard>
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(values) => create.mutate(values)}
          initialValues={{ status: "ACTIVE", variants: [{}] }}
        >
          <ProductFormFields mode="create" />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              Tạo sản phẩm
            </Button>
            <Button onClick={() => router.push("/products")}>Hủy</Button>
          </div>
        </Form>
      </DetailCard>
    </DetailPage>
  );
}
