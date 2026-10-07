"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useClientList } from "@/hooks/useClientList";
import { useAction } from "@/hooks/useAction";
import { useHarvestOptions, useProductOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatQuantity } from "@/lib/format";
import { toNumeric } from "@/lib/format/form";
import { LOT_STATUS, lotStatus, statusOptions } from "@/lib/status";
import type { ProductLot } from "@/types/api";

// /lots only whitelists page/limit/search/status, so the product filter is
// applied in the browser.
const lotSearchText = (l: ProductLot) =>
  [l.code, l.traceCode, l.product?.name ?? ""].join(" ");

const lotFilter = (l: ProductLot, filters: Record<string, string | undefined>) => {
  if (filters.productId && String(l.productId) !== filters.productId) return false;
  if (filters.status && l.status !== filters.status) return false;
  return true;
};

export default function LotsPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const products = useProductOptions();
  const harvests = useHarvestOptions();

  const { data, total, isLoading, isError, refetch } = useClientList<ProductLot>({
    queryKey: queryKeys.lots({ scope: "admin-list" }),
    fetcher: resources.lots,
    state: list,
    searchText: lotSearchText,
    filter: lotFilter,
  });

  const create = useAction(
    (values: Record<string, unknown>) =>
      resources.createLot(toNumeric(values, ["productId", "harvestId", "quantity"])),
    {
      invalidate: [["lots"]],
      successMessage: "Đã tạo lô hàng.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const columns: ColumnsType<ProductLot> = [
    {
      title: "Lô hàng",
      render: (_, row) => (
        <div>
          <Link href={`/lots/${row.id}`} className="agri-link">
            {row.code}
          </Link>
          <div className="agri-muted agri-mono" style={{ fontSize: 12 }}>
            {row.traceCode}
          </div>
        </div>
      ),
    },
    { title: "Sản phẩm", render: (_, row) => row.product?.name ?? "—" },
    { title: "Phân loại", dataIndex: "grade" },
    {
      title: "Số lượng",
      align: "right",
      render: (_, row) => (
        <span className="agri-nowrap">{formatQuantity(row.quantity, row.unit)}</span>
      ),
    },
    {
      title: "Còn lại",
      align: "right",
      render: (_, row) => (
        <span className="agri-nowrap">{formatQuantity(row.remainingQuantity, row.unit)}</span>
      ),
    },
    {
      title: "Hết hạn",
      dataIndex: "expiresAt",
      render: (v: string) => <span className="agri-nowrap">{formatDate(v)}</span>,
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={lotStatus(s)} />,
    },
  ];

  return (
    <>
      <ListPage<ProductLot>
        title="Lô & QR"
        subtitle="Lô hàng truy xuất nguồn gốc"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Tìm theo mã lô, mã truy xuất, sản phẩm..."
        filters={[
          {
            key: "productId",
            placeholder: "Sản phẩm",
            value: list.filters.productId,
            options: (products.data ?? []).map((o) => ({ label: o.label, value: String(o.value) })),
            width: 220,
          },
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(LOT_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Tạo lô
          </Button>
        }
        columns={columns}
        data={data}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách lô hàng.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có lô hàng phù hợp"
        total={total}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1120}
        itemLabel="lô"
      />

      <FormModal
        open={open}
        title="Tạo lô hàng"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => create.mutate(values)}
        submitting={create.isPending}
        width={560}
        okText="Tạo lô"
      >
        <Form.Item label="Sản phẩm" name="productId" rules={[{ required: true, message: "Chọn sản phẩm." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={products.isLoading}
            options={products.data}
            placeholder="Chọn sản phẩm"
          />
        </Form.Item>
        <Form.Item
          label="Vụ thu hoạch"
          name="harvestId"
          rules={[{ required: true, message: "Chọn vụ thu hoạch." }]}
          extra="Tổng số lượng các lô không được vượt quá sản lượng thu hoạch."
        >
          <Select
            showSearch
            optionFilterProp="label"
            loading={harvests.isLoading}
            options={harvests.data}
            placeholder="Chọn vụ thu hoạch"
          />
        </Form.Item>
        <Form.Item label="Số lượng" name="quantity" rules={[{ required: true, message: "Nhập số lượng." }]}>
          <Input type="number" placeholder="VD: 300" />
        </Form.Item>
        <Form.Item label="Đơn vị" name="unit" rules={[{ required: true, message: "Nhập đơn vị." }]}>
          <Input placeholder="VD: kg" />
        </Form.Item>
        <Form.Item label="Phân loại" name="grade" rules={[{ required: true, message: "Nhập phân loại." }]}>
          <Input placeholder="VD: Loại 1" />
        </Form.Item>
        <Form.Item label="Ngày hết hạn" name="expiresAt" rules={[{ required: true, message: "Chọn ngày hết hạn." }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item label="Ngày đóng gói" name="packedAt">
          <Input type="date" />
        </Form.Item>
        <p className="agri-muted" style={{ margin: 0, fontSize: 12 }}>
          Lô mới luôn ở trạng thái Chờ kiểm định — chỉ chuyển sang Có thể bán sau khi kiểm định đạt.
        </p>
      </FormModal>
    </>
  );
}
