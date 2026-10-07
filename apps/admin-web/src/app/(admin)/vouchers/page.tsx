"use client";

import { useState } from "react";
import { Button, DatePicker, Form, Input, InputNumber, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { num } from "@/lib/format/form";
import { DISCOUNT_TYPE, RECORD_STATUS, recordStatus, statusOptions } from "@/lib/status";
import type { Voucher } from "@/types/api";

type VoucherForm = {
  code: string;
  name: string;
  discountType: string;
  discountValue: number;
  minOrderAmount?: number;
  maxDiscount?: number;
  usageLimit?: number;
  perCustomerLimit?: number;
  period: [Dayjs, Dayjs];
  status: string;
};

export default function VouchersPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<VoucherForm>();

  const { data, isLoading, isError, refetch } = useListQuery<Voucher>(
    queryKeys.vouchers(list.params),
    resources.vouchers,
    list.params,
  );

  const create = useAction(
    (values: VoucherForm) => {
      const [startsAt, endsAt] = values.period;
      return resources.createVoucher({
        code: values.code,
        name: values.name,
        discountType: values.discountType,
        discountValue: num(values.discountValue),
        minOrderAmount: num(values.minOrderAmount),
        maxDiscount: num(values.maxDiscount),
        usageLimit: num(values.usageLimit),
        perCustomerLimit: num(values.perCustomerLimit),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status: values.status,
      });
    },
    {
      invalidate: [["vouchers"]],
      successMessage: "Đã tạo voucher.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const columns: ColumnsType<Voucher> = [
    {
      title: "Voucher",
      render: (_, row) => (
        <div>
          <div className="agri-mono">{row.code}</div>
          <div className="agri-muted" style={{ fontSize: 12 }}>
            {row.name}
          </div>
        </div>
      ),
    },
    {
      title: "Giảm giá",
      render: (_, row) => (
        <span className="agri-nowrap">
          {row.discountType === "PERCENT"
            ? `${formatNumber(row.discountValue)}%`
            : formatMoney(row.discountValue)}
        </span>
      ),
    },
    {
      title: "Đơn tối thiểu",
      dataIndex: "minOrderAmount",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
    },
    {
      title: "Đã dùng / Giới hạn",
      align: "right",
      render: (_, row) => (
        <span className="agri-nowrap">
          {formatNumber(row.usedCount)} / {row.usageLimit ?? "∞"}
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
      <ListPage<Voucher>
        title="Voucher"
        subtitle="Mã giảm giá theo đơn hàng"
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
            Thêm voucher
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách voucher.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có voucher phù hợp"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1080}
        itemLabel="voucher"
      />

      <FormModal
        open={open}
        title="Thêm voucher"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => create.mutate(values)}
        submitting={create.isPending}
        width={560}
      >
        <Form.Item label="Mã voucher" name="code" rules={[{ required: true, message: "Nhập mã voucher." }]}>
          <Input placeholder="VD: HUNGYEN50K" />
        </Form.Item>
        <Form.Item label="Tên voucher" name="name" rules={[{ required: true, message: "Nhập tên voucher." }]}>
          <Input placeholder="VD: Giảm 50.000đ cho đơn từ 300.000đ" />
        </Form.Item>
        <Form.Item label="Loại giảm giá" name="discountType" rules={[{ required: true, message: "Chọn loại." }]}>
          <Select options={statusOptions(DISCOUNT_TYPE)} placeholder="Chọn loại giảm giá" />
        </Form.Item>
        <Form.Item label="Giá trị giảm" name="discountValue" rules={[{ required: true, message: "Nhập giá trị." }]}>
          <InputNumber min={0} style={{ width: "100%" }} placeholder="VD: 50000 hoặc 10" />
        </Form.Item>
        <Form.Item label="Đơn tối thiểu" name="minOrderAmount">
          <InputNumber min={0} style={{ width: "100%" }} placeholder="VD: 300000" />
        </Form.Item>
        <Form.Item label="Giảm tối đa" name="maxDiscount">
          <InputNumber min={0} style={{ width: "100%" }} placeholder="VD: 100000" />
        </Form.Item>
        <Form.Item label="Giới hạn lượt dùng" name="usageLimit">
          <InputNumber min={1} style={{ width: "100%" }} placeholder="VD: 500" />
        </Form.Item>
        <Form.Item label="Giới hạn mỗi khách" name="perCustomerLimit">
          <InputNumber min={1} style={{ width: "100%" }} placeholder="VD: 1" />
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
