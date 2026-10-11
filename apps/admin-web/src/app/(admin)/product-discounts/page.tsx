"use client";

import { useState } from "react";
import { App, Button, DatePicker, Form, InputNumber, Select } from "antd";
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
import { RECORD_STATUS, discountType, recordStatus, statusOptions } from "@/lib/status";
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
  const { modal } = App.useApp();
  const discountKind = Form.useWatch("discountType", form);
  const isPercent = discountKind === "PERCENT";

  const { data, isLoading, isError, refetch } = useListQuery<ProductDiscount>(
    queryKeys.productDiscounts(list.params),
    resources.productDiscounts,
    list.params,
  );

  const setStatus = useAction(
    (vars: { id: number; status: "ACTIVE" | "INACTIVE" }) =>
      resources.updateProductDiscountStatus(vars.id, vars.status),
    {
      invalidate: [["product-discounts"]],
      successMessage: "Đã cập nhật trạng thái giảm giá.",
    },
  );

  const confirmDeactivate = (row: ProductDiscount) => {
    modal.confirm({
      title: "Ngừng giảm giá này?",
      content: "Quy cách bán sẽ trở về giá gốc cho các đơn mới.",
      okText: "Ngừng",
      okType: "danger",
      cancelText: "Hủy",
      onOk: () => setStatus.mutate({ id: row.id, status: "INACTIVE" }),
    });
  };

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
      title: "Quy cách bán",
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
    {
      title: "Thao tác",
      width: 120,
      fixed: "right",
      render: (_, row) =>
        row.status === "ACTIVE" ? (
          <Button
            type="link"
            size="small"
            danger
            style={{ paddingInline: 0 }}
            onClick={() => confirmDeactivate(row)}
          >
            Ngừng
          </Button>
        ) : (
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0 }}
            loading={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: row.id, status: "ACTIVE" })}
          >
            Kích hoạt
          </Button>
        ),
    },
  ];

  return (
    <>
      <ListPage<ProductDiscount>
        title="Giảm giá sản phẩm"
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
        scrollX={1080}
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
        <Form.Item label="Quy cách bán" name="productVariantId" rules={[{ required: true, message: "Chọn quy cách bán." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={variants.isLoading}
            options={variants.data}
            placeholder="Chọn quy cách bán"
          />
        </Form.Item>
        <Form.Item label="Loại giảm giá" name="discountType" rules={[{ required: true, message: "Chọn loại." }]}>
          <Select
            options={[
              { value: "PERCENT", label: "Phần trăm (%)" },
              { value: "FIXED", label: "Số tiền (đ)" },
            ]}
            placeholder="Chọn loại giảm giá"
          />
        </Form.Item>
        <Form.Item
          label={isPercent ? "Giá trị giảm (%)" : "Giá trị giảm (đ)"}
          name="discountValue"
          rules={[
            { required: true, message: "Nhập giá trị." },
            {
              validator: async (_, value) => {
                if (value === undefined || value === null || value === "") return;
                const n = Number(value);
                if (!Number.isFinite(n) || n < 0) {
                  throw new Error("Giá trị giảm phải là số không âm.");
                }
                if (isPercent && n > 100) {
                  throw new Error("Giảm theo phần trăm tối đa là 100%.");
                }
              },
            },
          ]}
        >
          <InputNumber
            min={0}
            max={isPercent ? 100 : undefined}
            style={{ width: "100%" }}
            placeholder={isPercent ? "VD: 10" : "VD: 5000"}
          />
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
