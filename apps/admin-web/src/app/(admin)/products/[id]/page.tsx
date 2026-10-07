"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button, Form, Input, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { ProductFormFields } from "@/components/product/ProductFormFields";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatMoney, formatDateTime } from "@/lib/format";
import { recordStatus } from "@/lib/status";
import type { Product, ProductVariant } from "@/types/api";

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [editOpen, setEditOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [variantForm] = Form.useForm();

  const { data: product, isLoading, isError, refetch } = useDetailQuery<Product>(
    queryKeys.product(id),
    () => resources.product(id),
  );

  const update = useAction(
    (values: Record<string, unknown>) => resources.updateProduct(id, values),
    {
      invalidate: [queryKeys.product(id), ["products"]],
      successMessage: "Đã cập nhật sản phẩm.",
      onSuccess: () => setEditOpen(false),
    },
  );

  const addVariant = useAction(
    (values: Record<string, unknown>) => resources.addVariant(id, values),
    {
      invalidate: [queryKeys.product(id), ["products"]],
      successMessage: "Đã thêm biến thể.",
      onSuccess: () => {
        setVariantOpen(false);
        variantForm.resetFields();
      },
    },
  );

  const variantColumns: ColumnsType<ProductVariant> = [
    { title: "SKU", dataIndex: "sku", render: (v: string) => <span className="agri-mono">{v}</span> },
    { title: "Tên", dataIndex: "name" },
    {
      title: "Khối lượng",
      render: (_, row) => (row.weight ? `${row.weight} ${row.weightUnit ?? ""}`.trim() : "—"),
    },
    { title: "Đơn vị bán", dataIndex: "saleUnit" },
    {
      title: "Giá bán",
      dataIndex: "basePrice",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={recordStatus(s)} />,
    },
  ];

  return (
    <DetailPage
      title={product ? product.name : "Chi tiết sản phẩm"}
      subtitle={product ? `Cập nhật ${formatDateTime(product.updatedAt)}` : undefined}
      backHref="/products"
      backLabel="Danh sách sản phẩm"
      loading={isLoading}
      error={isError ? new Error("Không tải được sản phẩm.") : undefined}
      onRetry={() => void refetch()}
      extra={
        product ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusTag status={recordStatus(product.status)} />
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                editForm.setFieldsValue({
                  name: product.name,
                  slug: product.slug,
                  categoryId: product.categoryId,
                  farmId: product.farmId ?? undefined,
                  description: product.description ?? undefined,
                  status: product.status,
                });
                setEditOpen(true);
              }}
            >
              Chỉnh sửa
            </Button>
          </div>
        ) : undefined
      }
    >
      {product ? (
        <>
          <DetailCard title="Thông tin chung">
            <InfoDescriptions
              items={[
                { key: "slug", label: "Slug", children: <span className="agri-mono">{product.slug}</span> },
                { key: "category", label: "Danh mục", children: product.category?.name ?? "—" },
                { key: "partner", label: "Đối tác", children: product.partner?.name ?? "—" },
                { key: "farm", label: "Trang trại", children: product.farmId ? `#${product.farmId}` : "—" },
                {
                  key: "created",
                  label: "Ngày tạo",
                  children: formatDateTime(product.createdAt),
                },
                {
                  key: "updated",
                  label: "Cập nhật",
                  children: formatDateTime(product.updatedAt),
                },
                {
                  key: "description",
                  label: "Mô tả",
                  span: 2,
                  children: product.description ?? "—",
                },
              ]}
            />
          </DetailCard>

          {product.images && product.images.length > 0 ? (
            <DetailCard title="Hình ảnh">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {product.images.map((img) => (
                  <a
                    key={img.id}
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    className="agri-link"
                    style={{ fontSize: 12 }}
                  >
                    {img.isPrimary ? "★ " : ""}
                    {img.url}
                  </a>
                ))}
              </div>
            </DetailCard>
          ) : null}

          <DetailCard
            title="Biến thể"
            extra={
              <Button size="small" icon={<PlusOutlined />} onClick={() => setVariantOpen(true)}>
                Thêm biến thể
              </Button>
            }
          >
            <Table<ProductVariant>
              size="small"
              rowKey="id"
              columns={variantColumns}
              dataSource={product.variants ?? []}
              pagination={false}
              locale={{ emptyText: "Chưa có biến thể" }}
            />
          </DetailCard>

          <FormModal
            open={editOpen}
            title="Chỉnh sửa sản phẩm"
            form={editForm}
            onCancel={() => setEditOpen(false)}
            onSubmit={(values) => update.mutate(values)}
            submitting={update.isPending}
          >
            <ProductFormFields mode="edit" />
          </FormModal>

          <FormModal
            open={variantOpen}
            title="Thêm biến thể"
            form={variantForm}
            onCancel={() => setVariantOpen(false)}
            onSubmit={(values) =>
              addVariant.mutate({
                ...values,
                basePrice: Number(values.basePrice),
                weight: values.weight ? Number(values.weight) : undefined,
              })
            }
            submitting={addVariant.isPending}
          >
            <Form.Item label="SKU" name="sku" rules={[{ required: true, message: "Nhập SKU." }]}>
              <Input placeholder="VD: CCB-500G" />
            </Form.Item>
            <Form.Item label="Tên biến thể" name="name" rules={[{ required: true, message: "Nhập tên." }]}>
              <Input placeholder="VD: Gói 500 g" />
            </Form.Item>
            <Form.Item label="Đơn vị bán" name="saleUnit" rules={[{ required: true, message: "Nhập đơn vị." }]}>
              <Input placeholder="VD: gói" />
            </Form.Item>
            <Form.Item label="Khối lượng" name="weight">
              <Input type="number" placeholder="VD: 500" />
            </Form.Item>
            <Form.Item label="Đơn vị khối lượng" name="weightUnit">
              <Input placeholder="VD: g" />
            </Form.Item>
            <Form.Item label="Giá bán" name="basePrice" rules={[{ required: true, message: "Nhập giá." }]}>
              <Input type="number" placeholder="VD: 32000" />
            </Form.Item>
          </FormModal>

          <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            Lưu ý: giá và khối lượng hiển thị theo định dạng Việt Nam.
          </Typography.Paragraph>
        </>
      ) : null}
    </DetailPage>
  );
}
