"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Form } from "antd";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { ProductFormFields } from "@/components/product/ProductFormFields";
import { ProductImageStaging } from "@/components/product/ProductImagesManager";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import type { Product } from "@/types/api";

interface VariantForm {
  sku: string;
  name: string;
  saleUnit: string;
  weight?: number;
  weightUnit?: string;
  basePrice: number;
}

interface ProductForm {
  name: string;
  partnerId: number;
  categoryId: number;
  farmId?: number;
  description?: string;
  status: string;
  variants?: VariantForm[];
}

export default function NewProductPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<ProductForm>();
  const [staged, setStaged] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const create = useAction(
    async (values: ProductForm) => {
      const created: Product = await resources.createProduct({
        ...values,
        variants: values.variants
          ?.filter((v) => v.sku || v.name)
          .map((v) => ({
            ...v,
            basePrice: Number(v.basePrice),
            weight: v.weight ? Number(v.weight) : undefined,
            weightUnit: v.weightUnit || undefined,
          })),
      });
      if (staged.length > 0) {
        setUploading(true);
        try {
          for (const file of staged) {
            await resources.uploadProductImage(created.id, file);
          }
        } catch (err) {
          message.warning(
            err instanceof Error
              ? `Đã tạo sản phẩm, nhưng tải ảnh chưa xong: ${err.message} Mở chi tiết sản phẩm để tải lại ảnh lỗi.`
              : "Đã tạo sản phẩm, nhưng tải ảnh chưa xong. Mở chi tiết sản phẩm để tải lại ảnh lỗi.",
          );
          return created;
        } finally {
          setUploading(false);
        }
      }
      return created;
    },
    {
      invalidate: [["products"]],
      successMessage: "Đã lưu sản phẩm.",
      onSuccess: (created: Product) => router.replace(`/products/${created.id}`),
    },
  );

  return (
    <DetailPage
      title="Thêm sản phẩm"
      backHref="/products"
      backLabel="Danh sách sản phẩm"
    >
      <DetailCard>
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          preserve
          onFinish={(values) => create.mutate(values)}
          initialValues={{ status: "ACTIVE", variants: [{}] }}
        >
          <ProductFormFields
            mode="create"
            imageSection={<ProductImageStaging value={staged} onChange={setStaged} />}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button type="primary" htmlType="submit" loading={create.isPending || uploading}>
              Lưu
            </Button>
            <Button onClick={() => router.push("/products")}>Hủy</Button>
          </div>
        </Form>
      </DetailCard>
    </DetailPage>
  );
}
