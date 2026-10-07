"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, DatePicker, Form, Input, InputNumber, Select, Tabs } from "antd";
import { PlusOutlined, DollarOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { usePartnerOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { num } from "@/lib/format/form";
import {
  PAYOUT_STATUS,
  SETTLEMENT_STATUS,
  payoutStatus,
  settlementStatus,
  statusOptions,
} from "@/lib/status";
import type { Payout, Settlement } from "@/types/api";

type SettlementForm = {
  partnerId: number;
  period: [Dayjs, Dayjs];
  adjustmentAmount?: number;
};

function SettlementsTab() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<SettlementForm>();
  const partners = usePartnerOptions();

  const { data, isLoading, isError, refetch } = useListQuery<Settlement>(
    queryKeys.settlements(list.params),
    resources.settlements,
    list.params,
  );

  const create = useAction(
    (values: SettlementForm) => {
      const [periodStart, periodEnd] = values.period;
      return resources.createSettlement({
        partnerId: num(values.partnerId),
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        adjustmentAmount: num(values.adjustmentAmount),
      });
    },
    {
      invalidate: [["settlements"]],
      successMessage: "Đã tạo kỳ đối soát.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const columns: ColumnsType<Settlement> = [
    {
      title: "Kỳ đối soát",
      render: (_, row) => (
        <Link href={`/settlements/${row.id}`} className="agri-link agri-mono">
          {row.code}
        </Link>
      ),
    },
    { title: "Đối tác", render: (_, row) => row.partner?.name ?? "—" },
    {
      title: "Khoảng thời gian",
      render: (_, row) => (
        <span className="agri-nowrap">
          {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
        </span>
      ),
    },
    {
      title: "Doanh thu",
      dataIndex: "grossAmount",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
    },
    {
      title: "Hoa hồng",
      dataIndex: "commissionAmount",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
    },
    {
      title: "Phải trả",
      dataIndex: "payableAmount",
      align: "right",
      render: (v: string) => <strong className="agri-nowrap">{formatMoney(v)}</strong>,
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={settlementStatus(s)} />,
    },
  ];

  return (
    <>
      <ListPage<Settlement>
        title="Đối soát"
        subtitle="Đối soát doanh thu và hoa hồng theo đối tác"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(SETTLEMENT_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Tạo đối soát
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách đối soát.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có kỳ đối soát"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1120}
        itemLabel="kỳ đối soát"
      />

      <FormModal
        open={open}
        title="Tạo kỳ đối soát"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => create.mutate(values)}
        submitting={create.isPending}
        width={560}
      >
        <Form.Item label="Đối tác" name="partnerId" rules={[{ required: true, message: "Chọn đối tác." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={partners.isLoading}
            options={partners.data}
            placeholder="Chọn đối tác"
          />
        </Form.Item>
        <Form.Item label="Kỳ đối soát" name="period" rules={[{ required: true, message: "Chọn khoảng thời gian." }]}>
          <DatePicker.RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Điều chỉnh" name="adjustmentAmount" extra="Có thể âm. Để trống nếu không điều chỉnh.">
          <InputNumber style={{ width: "100%" }} placeholder="VD: 0" />
        </Form.Item>
      </FormModal>
    </>
  );
}

function PayoutsTab() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const settlements = useListQuery<Settlement>(
    queryKeys.settlements({ scope: "payout-lookup" }),
    resources.settlements,
    { limit: 100 },
  );
  const payableSettlements = (settlements.data?.data ?? []).filter(
    (s) => s.status === "CONFIRMED" || s.status === "PAID",
  );

  const { data, isLoading, isError, refetch } = useListQuery<Payout>(
    queryKeys.payouts(list.params),
    resources.payouts,
    list.params,
  );

  const create = useAction(
    (values: { settlementId: number; amount?: number; reference?: string }) =>
      resources.createPayout({
        settlementId: num(values.settlementId),
        amount: num(values.amount),
        reference: values.reference,
      }),
    {
      invalidate: [["payouts"], ["settlements"]],
      successMessage: "Đã tạo lệnh chi trả.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const pay = useAction((id: number) => resources.payPayout(id), {
    invalidate: [["payouts"], ["settlements"]],
    successMessage: "Đã đánh dấu chi trả.",
  });

  const columns: ColumnsType<Payout> = [
    {
      title: "Lệnh chi trả",
      render: (_, row) => <span className="agri-mono">{row.code}</span>,
    },
    { title: "Đối tác", render: (_, row) => row.partner?.name ?? "—" },
    {
      title: "Kỳ đối soát",
      render: (_, row) =>
        row.settlement ? (
          <Link href={`/settlements/${row.settlement.id}`} className="agri-link agri-mono">
            {row.settlement.code}
          </Link>
        ) : (
          `#${row.settlementId}`
        ),
    },
    {
      title: "Số tiền",
      dataIndex: "amount",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={payoutStatus(s)} />,
    },
    {
      title: "Ngày yêu cầu",
      dataIndex: "requestedAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Thao tác",
      width: 120,
      fixed: "right",
      render: (_, row) =>
        row.status === "PENDING" ? (
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0 }}
            loading={pay.isPending}
            onClick={() => pay.mutate(row.id)}
          >
            Chi trả
          </Button>
        ) : (
          <span className="agri-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <ListPage<Payout>
        title="Chi trả"
        subtitle="Lệnh chi trả cho đối tác"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(PAYOUT_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<DollarOutlined />} onClick={() => setOpen(true)}>
            Tạo lệnh chi trả
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách chi trả.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có lệnh chi trả"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1120}
        itemLabel="lệnh chi trả"
      />

      <FormModal
        open={open}
        title="Tạo lệnh chi trả"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => create.mutate(values as { settlementId: number; amount?: number; reference?: string })}
        submitting={create.isPending}
        width={520}
        okText="Tạo"
      >
        <Form.Item
          label="Kỳ đối soát"
          name="settlementId"
          rules={[{ required: true, message: "Chọn kỳ đối soát." }]}
          extra="Chỉ hiển thị kỳ đối soát đã xác nhận."
        >
          <Select
            showSearch
            optionFilterProp="label"
            loading={settlements.isLoading}
            options={payableSettlements.map((s) => ({
              label: `${s.code} — ${s.partner?.name ?? ""} (${formatMoney(s.payableAmount)})`,
              value: s.id,
            }))}
            placeholder="Chọn kỳ đối soát"
          />
        </Form.Item>
        <Form.Item label="Số tiền" name="amount" extra="Để trống để chi trả toàn bộ số còn lại.">
          <InputNumber min={0} style={{ width: "100%" }} placeholder="VD: 247000" />
        </Form.Item>
        <Form.Item label="Mã tham chiếu" name="reference">
          <Input placeholder="VD: FT2601234567" />
        </Form.Item>
      </FormModal>
    </>
  );
}

export default function SettlementsPage() {
  return (
    <Tabs
      defaultActiveKey="settlements"
      items={[
        { key: "settlements", label: "Đối soát", children: <SettlementsTab /> },
        { key: "payouts", label: "Chi trả", children: <PayoutsTab /> },
      ]}
    />
  );
}
