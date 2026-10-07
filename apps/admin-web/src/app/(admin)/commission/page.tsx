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
import { useCategoryOptions, usePartnerOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatPercent } from "@/lib/format";
import { num } from "@/lib/format/form";
import { RECORD_STATUS, recordStatus, statusOptions } from "@/lib/status";
import type { CommissionRule } from "@/types/api";

type RuleForm = {
  partnerId?: number;
  categoryId?: number;
  ratePercent: number;
  effectiveFrom: Dayjs;
  effectiveTo?: Dayjs | null;
  status?: string;
};

export default function CommissionPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<RuleForm>();
  const partners = usePartnerOptions();
  const categories = useCategoryOptions();

  const { data, isLoading, isError, refetch } = useListQuery<CommissionRule>(
    queryKeys.commissionRules(list.params),
    resources.commissionRules,
    list.params,
  );

  const create = useAction(
    (values: RuleForm) =>
      resources.createCommissionRule({
        partnerId: num(values.partnerId),
        categoryId: num(values.categoryId),
        ratePercent: num(values.ratePercent),
        effectiveFrom: values.effectiveFrom.toISOString(),
        effectiveTo: values.effectiveTo ? values.effectiveTo.toISOString() : undefined,
      }),
    {
      invalidate: [["commission-rules"]],
      successMessage: "Đã tạo quy tắc hoa hồng.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const columns: ColumnsType<CommissionRule> = [
    {
      title: "Đối tác",
      render: (_, row) => row.partner?.name ?? "Tất cả đối tác",
    },
    {
      title: "Danh mục",
      render: (_, row) => row.category?.name ?? "Tất cả danh mục",
    },
    {
      title: "Tỷ lệ",
      dataIndex: "ratePercent",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatPercent(v)}</span>,
    },
    {
      title: "Hiệu lực",
      render: (_, row) => (
        <span className="agri-nowrap">
          {formatDate(row.effectiveFrom)} – {row.effectiveTo ? formatDate(row.effectiveTo) : "∞"}
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
      <ListPage<CommissionRule>
        title="Hoa hồng"
        subtitle="Quy tắc hoa hồng theo đối tác và danh mục"
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
            Thêm quy tắc
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách quy tắc hoa hồng.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có quy tắc hoa hồng"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={960}
        itemLabel="quy tắc"
      />

      <FormModal
        open={open}
        title="Thêm quy tắc hoa hồng"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => create.mutate(values)}
        submitting={create.isPending}
        width={560}
      >
        <Form.Item label="Đối tác" name="partnerId" extra="Để trống nếu áp dụng cho tất cả đối tác.">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            loading={partners.isLoading}
            options={partners.data}
            placeholder="Tất cả đối tác"
          />
        </Form.Item>
        <Form.Item label="Danh mục" name="categoryId" extra="Để trống nếu áp dụng cho tất cả danh mục.">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            loading={categories.isLoading}
            options={categories.data}
            placeholder="Tất cả danh mục"
          />
        </Form.Item>
        <Form.Item
          label="Tỷ lệ hoa hồng (%)"
          name="ratePercent"
          rules={[{ required: true, message: "Nhập tỷ lệ." }]}
        >
          <InputNumber min={0} max={100} step={0.5} style={{ width: "100%" }} placeholder="VD: 5" />
        </Form.Item>
        <Form.Item label="Hiệu lực từ" name="effectiveFrom" rules={[{ required: true, message: "Chọn ngày." }]}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Hiệu lực đến" name="effectiveTo">
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
      </FormModal>
    </>
  );
}
