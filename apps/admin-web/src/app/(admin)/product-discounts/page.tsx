"use client";

import { useState } from "react";
import { Button, DatePicker, Form, InputNumber, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { useVariantOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { num } from "@/lib/format/form";
import { DISCOUNT_TYPE, RECORD_STATUS, discountType, recordStatus, statusOptions } from "@/lib/status";
import type { ProductDiscount } from "@/types/api";

type DiscountForm = {
  productVariantId: number;
  discountType: string;
  discountValue: number;
  period: [Dayjs, Dayjs];
  status: string;
};

export default function ProductDiscountsPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<DiscountForm>();
  const variants = useVariantOptions();

  const { data, isLoading, isError, refetch } = useListQuery<ProductDiscount>(
    queryKeys.productDiscounts(list.params),
    resources.productDiscounts,
    list.params,
  );

  const create = useAction(
    (values: DiscountForm) => {
      const [startsAt, endsAt] = values.period;
      return resources.createProductDiscount({
        productVariantId: num(values.productVariantId),
        discountType: values.discountType,
        discountValue: num(values.discountValue),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status: values.status,
      });
    },
    {
      invalidate: [["product-discounts"]],
      successMessage: "Đã tạo giảm giá sản phẩm.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const columns: ColumnsType<ProductDiscount> = [
    {
      title: "Biến thể",
      render: (_, row) => (
        <div>
          <div>{row.productVariant?.name ?? `#${row.productVariantId}`}</div>
          <div className="agri-muted agri-mono" style={{ fontSize: 12 }}>
            {row.productVariant?.sku}
          </div>
        </div>
      ),
    },
    {
      title: "Loại",
      dataIndex: "discountType",
      render: (t: string) => <StatusTag status={discountType(t)} />,
    },
    {
      title: "Giá trị",
      align: "right",
      render: (_, row) => (
        <span className="agri-nowrap">
          {row.discountType === "PERCENT"
            ? `${formatNumber(row.discountValue)}%`
            : formatMoney(row.discountValue)}
        </span>
      ),
    },
    {
      title: "Hiệu lực",
      render: (_, row) => (
        <span className="agri-nowrap">
          {formatDate(row.startsAt)} – {formatDate(row.endsAt)}
        </span>
      ),
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={recordStatus(s)} />,
    },
  ];

  return (
    <>
      <ListPage<ProductDiscount>
        title="Giảm giá sản phẩm"
        subtitle="Giảm giá tự động theo biến thể"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(RECORD_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Thêm giảm giá
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách giảm giá.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có giảm giá phù hợp"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={960}
        itemLabel="chương trình"
      />

      <FormModal
        open={open}
        title="Thêm giảm giá sản phẩm"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => create.mutate(values)}
        submitting={create.isPending}
        width={560}
      >
        <Form.Item label="Biến thể" name="productVariantId" rules={[{ required: true, message: "Chọn biến thể." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={variants.isLoading}
            options={variants.data}
            placeholder="Chọn biến thể"
          />
        </Form.Item>
        <Form.Item label="Loại giảm giá" name="discountType" rules={[{ required: true, message: "Chọn loại." }]}>
          <Select options={statusOptions(DISCOUNT_TYPE)} placeholder="Chọn loại giảm giá" />
        </Form.Item>
        <Form.Item label="Giá trị giảm" name="discountValue" rules={[{ required: true, message: "Nhập giá trị." }]}>
          <InputNumber min={0} style={{ width: "100%" }} placeholder="VD: 10 hoặc 5000" />
        </Form.Item>
        <Form.Item label="Thời gian hiệu lực" name="period" rules={[{ required: true, message: "Chọn thời gian." }]}>
          <DatePicker.RangePicker showTime style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Trạng thái" name="status" initialValue="ACTIVE">
          <Select options={statusOptions(RECORD_STATUS)} />
        </Form.Item>
      </FormModal>
    </>
  );
}
