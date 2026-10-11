"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { App, Button, Form, Input, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { ProductFormFields } from "@/components/product/ProductFormFields";
import { ProductImagesManager } from "@/components/product/ProductImagesManager";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useAction } from "@/hooks/useAction";
import { useFarmOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatMoney, formatDateTime } from "@/lib/format";
import { recordStatus } from "@/lib/status";
import type { Product, ProductVariant } from "@/types/api";

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { modal } = App.useApp();

  const [editOpen, setEditOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [editForm] = Form.useForm();
  const [variantForm] = Form.useForm();
  const [variantEditForm] = Form.useForm();
  const farms = useFarmOptions();

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
      successMessage: "Đã thêm quy cách bán.",
      onSuccess: () => {
        setVariantOpen(false);
        variantForm.resetFields();
      },
    },
  );

  const updateVariant = useAction(
    (vars: { variantId: number; values: Record<string, unknown> }) =>
      resources.updateVariant(vars.variantId, vars.values),
    {
      invalidate: [queryKeys.product(id), ["products"]],
      successMessage: "Đã cập nhật quy cách bán.",
      onSuccess: () => {
        setEditingVariant(null);
        variantEditForm.resetFields();
      },
    },
  );

  const toggleVariantStatus = (row: ProductVariant) => {
    const toInactive = row.status === "ACTIVE";
    const apply = () =>
      updateVariant.mutate({
        variantId: row.id,
        values: { status: toInactive ? "INACTIVE" : "ACTIVE" },
      });
    // Stopping a sale affects revenue; restoring is harmless — confirm only
    // the stop. Past orders keep their price snapshots either way.
    if (toInactive) {
      modal.confirm({
        title: `Ngừng bán quy cách ${row.name}?`,
        content: "Quy cách sẽ không thể thêm vào đơn mới. Đơn đã bán không thay đổi.",
        okText: "Ngừng bán",
        okButtonProps: { danger: true },
        cancelText: "Hủy",
        onOk: () => apply(),
      });
    } else {
      apply();
    }
  };

  const variantColumns: ColumnsType<ProductVariant> = [
    { title: "Mã hàng", dataIndex: "sku", render: (v: string) => <span className="agri-mono">{v}</span> },
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
    {
      title: "Thao tác",
      width: 170,
      fixed: "right",
      render: (_, row) => (
        <span style={{ display: "inline-flex", gap: 8 }}>
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0 }}
            onClick={() => {
              setEditingVariant(row);
              variantEditForm.setFieldsValue({ name: row.name, basePrice: Number(row.basePrice) });
            }}
          >
            Sửa
          </Button>
          <Button
            type="link"
            size="small"
            danger={row.status === "ACTIVE"}
            style={{ paddingInline: 0 }}
            loading={updateVariant.isPending}
            onClick={() => toggleVariantStatus(row)}
          >
            {row.status === "ACTIVE" ? "Ngừng bán" : "Khôi phục"}
          </Button>
        </span>
      ),
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
                { key: "slug", label: "Đường dẫn sản phẩm", children: <span className="agri-mono">{product.slug}</span> },
                { key: "category", label: "Nhóm sản phẩm", children: product.category?.name ?? "—" },
                { key: "partner", label: "Đơn vị bán hàng", children: product.partner?.name ?? "—" },
                {
                  key: "farm",
                  label: "Trang trại",
                  children: product.farmId
                    ? (farms.data?.find((f) => f.value === product.farmId)?.label ??
                      `#${product.farmId}`)
                    : "—",
                },
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

          <DetailCard title="Hình ảnh">
            <ProductImagesManager
              productId={product.id}
              images={product.images ?? []}
              onRefresh={() => void refetch()}
              showHeading={false}
            />
          </DetailCard>

          <DetailCard
            title="Quy cách bán"
            extra={
              <Button size="small" icon={<PlusOutlined />} onClick={() => setVariantOpen(true)}>
                Thêm quy cách bán
              </Button>
            }
          >
            <Table<ProductVariant>
              size="small"
              rowKey="id"
              columns={variantColumns}
              dataSource={product.variants ?? []}
              pagination={false}
              locale={{ emptyText: "Chưa có quy cách bán" }}
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
            <ProductFormFields mode="edit" partnerId={product.partnerId} />
          </FormModal>

          <FormModal
            open={variantOpen}
            title="Thêm quy cách bán"
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
            <Form.Item label="Mã hàng" name="sku" rules={[{ required: true, message: "Nhập mã hàng." }]}>
              <Input placeholder="VD: CCB-500G" />
            </Form.Item>
            <Form.Item label="Tên quy cách" name="name" rules={[{ required: true, message: "Nhập tên." }]}>
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

          <FormModal
            open={!!editingVariant}
            title={`Sửa quy cách ${editingVariant?.sku ?? ""}`}
            form={variantEditForm}
            onCancel={() => setEditingVariant(null)}
            onSubmit={(values) => {
              if (!editingVariant) return;
              updateVariant.mutate({
                variantId: editingVariant.id,
                values: { name: values.name, basePrice: Number(values.basePrice) },
              });
            }}
            submitting={updateVariant.isPending}
          >
            <Form.Item label="Tên quy cách" name="name" rules={[{ required: true, message: "Nhập tên." }]}>
              <Input placeholder="VD: Gói 500 g" />
            </Form.Item>
            <Form.Item
              label="Giá bán (áp dụng cho đơn mới)"
              name="basePrice"
              rules={[{ required: true, message: "Nhập giá." }]}
            >
              <Input type="number" min={0} placeholder="VD: 32000" />
            </Form.Item>
          </FormModal>
        </>
      ) : null}
    </DetailPage>
  );
}
