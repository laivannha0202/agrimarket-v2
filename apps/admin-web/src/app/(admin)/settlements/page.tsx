"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, DatePicker, Form, Input, InputNumber, Select, Tabs, Tag } from "antd";
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
import { idempotencyKeyFor, type IdempotencyStore } from "@/lib/api/idempotency";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { num } from "@/lib/format/form";
import {
  PAYOUT_STATUS,
  SETTLEMENT_STATUS,
  SETTLEMENT_ADJUSTMENT_STATUS,
  SETTLEMENT_ADJUSTMENT_RESOLUTION,
  SETTLEMENT_RECOVERY_STATUS,
  payoutStatus,
  settlementStatus,
  settlementAdjustmentStatus,
  settlementAdjustmentResolution,
  settlementRecoveryStatus,
  statusOptions,
} from "@/lib/status";
import type {
  Payout,
  Settlement,
  SettlementAdjustment,
  SettlementAdjustmentResolution,
  SettlementRecovery,
} from "@/types/api";

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

function AdjustmentsTab() {
  const list = useListState();
  const [editing, setEditing] = useState<SettlementAdjustment | null>(null);
  const [form] = Form.useForm<{
    resolution: SettlementAdjustmentResolution;
    note: string;
  }>();

  const { data, isLoading, isError, refetch } = useListQuery<SettlementAdjustment>(
    queryKeys.settlementAdjustments(list.params),
    resources.settlementAdjustments,
    list.params,
  );

  const review = useAction(
    (vars: { id: number; resolution: SettlementAdjustmentResolution; note: string }) =>
      resources.reviewSettlementAdjustment(vars.id, {
        resolution: vars.resolution,
        note: vars.note,
      }),
    {
      invalidate: [["settlement-adjustments"], ["settlements"]],
      successMessage: "Đã ghi nhận hướng xử lý điều chỉnh.",
      onSuccess: () => {
        setEditing(null);
        form.resetFields();
      },
    },
  );

  const columns: ColumnsType<SettlementAdjustment> = [
    {
      title: "Đối tác",
      render: (_, row) => row.partner?.name ?? `#${row.partnerId}`,
    },
    {
      title: "Kỳ đối soát",
      render: (_, row) =>
        row.settlement ? (
          <Link href={`/settlements/${row.settlement.id}`} className="agri-link agri-mono">
            {row.settlement.code}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      title: "Đơn đối tác",
      render: (_, row) =>
        row.partnerOrder ? <span className="agri-mono">{row.partnerOrder.code}</span> : "—",
    },
    {
      title: "Hoàn tiền",
      align: "right",
      render: (_, row) =>
        row.refund ? <span className="agri-nowrap">{formatMoney(row.refund.amount)}</span> : "—",
    },
    {
      title: "Số tiền điều chỉnh",
      dataIndex: "amount",
      align: "right",
      render: (v: string) => <strong className="agri-nowrap">{formatMoney(v)}</strong>,
    },
    { title: "Lý do", dataIndex: "reason", ellipsis: true },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={settlementAdjustmentStatus(s)} />,
    },
    {
      title: "Hướng xử lý",
      render: (_, row) =>
        row.resolution ? (
          <StatusTag status={settlementAdjustmentResolution(row.resolution)} />
        ) : (
          "—"
        ),
    },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Thao tác",
      width: 110,
      fixed: "right",
      render: (_, row) =>
        row.status === "OPEN" ? (
          <Button
            type="link"
            size="small"
            onClick={() => setEditing(row)}
            style={{ paddingInline: 0 }}
          >
            Xử lý
          </Button>
        ) : (
          <Tag>Đã xử lý</Tag>
        ),
    },
  ];

  return (
    <>
      <ListPage<SettlementAdjustment>
        title="Điều chỉnh đối soát"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(SETTLEMENT_ADJUSTMENT_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách điều chỉnh đối soát.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có điều chỉnh đối soát"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1280}
        itemLabel="điều chỉnh"
      />

      <FormModal
        open={!!editing}
        title="Xử lý điều chỉnh đối soát"
        form={form}
        onCancel={() => {
          setEditing(null);
          form.resetFields();
        }}
        onSubmit={(values) => {
          if (!editing) return;
          review.mutate({ id: editing.id, ...values });
        }}
        submitting={review.isPending}
        okText="Ghi nhận"
        width={560}
      >
        {editing ? (
          <div style={{ marginBottom: 12 }}>
            <p style={{ marginTop: 0 }}>
              <strong>Đối tác:</strong> {editing.partner?.name ?? `#${editing.partnerId}`}
            </p>
            {editing.settlement ? (
              <p>
                <strong>Kỳ đối soát:</strong> {editing.settlement.code}
              </p>
            ) : null}
            {editing.refund ? (
              <p>
                <strong>Hoàn tiền:</strong> {formatMoney(editing.refund.amount)}
              </p>
            ) : null}
            <p>
              <strong>Số tiền điều chỉnh:</strong> {formatMoney(editing.amount)}
            </p>
            <p>
              <strong>Lý do:</strong> {editing.reason}
            </p>
          </div>
        ) : null}
        <Form.Item
          label="Hướng xử lý"
          name="resolution"
          rules={[{ required: true, message: "Chọn hướng xử lý." }]}
        >
          <Select
            options={statusOptions(SETTLEMENT_ADJUSTMENT_RESOLUTION)}
            placeholder="Chọn hướng xử lý"
          />
        </Form.Item>
        <Form.Item
          label="Căn cứ / ghi chú"
          name="note"
          rules={[{ required: true, whitespace: true, message: "Nhập căn cứ xử lý." }]}
        >
          <Input.TextArea
            rows={3}
            placeholder="VD: Trừ vào kỳ đối soát kế tiếp theo xác nhận của kế toán"
          />
        </Form.Item>
        <p className="agri-muted" style={{ margin: 0 }}>
          Kỳ đối soát gốc không bị sửa. Chọn “Trừ vào kỳ sau” sẽ mở một yêu cầu thu hồi
          chờ phê duyệt; xác nhận/chi trả vẫn bị khóa cho đến khi kế toán phê duyệt và ghi
          nhận đã thu hồi (hoặc từ chối).
        </p>
      </FormModal>
    </>
  );
}

function RecoveriesTab() {
  const list = useListState();
  const [decision, setDecision] = useState<{
    row: SettlementRecovery;
    action: "approve" | "reject";
  } | null>(null);
  const [recording, setRecording] = useState<SettlementRecovery | null>(null);
  const [decisionForm] = Form.useForm<{ note: string }>();
  const [recordForm] = Form.useForm<{ reference: string; note?: string }>();

  const { data, isLoading, isError, refetch } = useListQuery<SettlementRecovery>(
    queryKeys.settlementRecoveries(list.params),
    resources.settlementRecoveries,
    list.params,
  );

  const decide = useAction(
    (vars: { id: number; action: "approve" | "reject"; note: string }) =>
      vars.action === "approve"
        ? resources.approveSettlementRecovery(vars.id, vars.note)
        : resources.rejectSettlementRecovery(vars.id, vars.note),
    {
      invalidate: [
        ["settlement-recoveries"],
        ["settlement-adjustments"],
        ["settlements"],
        ["payouts"],
      ],
      successMessage: "Đã ghi nhận quyết định thu hồi.",
      onSuccess: () => {
        setDecision(null);
        decisionForm.resetFields();
      },
    },
  );

  const record = useAction(
    (vars: { id: number; reference: string; note?: string }) =>
      resources.recordSettlementRecovery(vars.id, {
        reference: vars.reference,
        note: vars.note,
      }),
    {
      invalidate: [["settlement-recoveries"], ["settlements"], ["payouts"]],
      successMessage: "Đã ghi nhận thu hồi và mở khóa chi trả.",
      onSuccess: () => {
        setRecording(null);
        recordForm.resetFields();
      },
    },
  );

  const columns: ColumnsType<SettlementRecovery> = [
    { title: "Đối tác", render: (_, row) => row.partner?.name ?? `#${row.partnerId}` },
    {
      title: "Kỳ đối soát nguồn",
      render: (_, row) =>
        row.adjustment?.settlement ? (
          <Link
            href={`/settlements/${row.adjustment.settlement.id}`}
            className="agri-link agri-mono"
          >
            {row.adjustment.settlement.code}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      title: "Hoàn tiền",
      align: "right",
      render: (_, row) =>
        row.adjustment?.refund ? (
          <span className="agri-nowrap">{formatMoney(row.adjustment.refund.amount)}</span>
        ) : (
          "—"
        ),
    },
    {
      title: "Số tiền cần thu hồi",
      dataIndex: "amount",
      align: "right",
      render: (v: string) => <strong className="agri-nowrap">{formatMoney(v)}</strong>,
    },
    { title: "Lý do", dataIndex: "reason", ellipsis: true },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={settlementRecoveryStatus(s)} />,
    },
    {
      title: "Căn cứ / tham chiếu",
      render: (_, row) => row.recoveryReference ?? row.decisionNote ?? "—",
      ellipsis: true,
    },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Thao tác",
      width: 190,
      fixed: "right",
      render: (_, row) => {
        if (row.status === "PENDING_APPROVAL") {
          return (
            <div style={{ display: "flex", gap: 4 }}>
              <Button
                type="link"
                size="small"
                style={{ paddingInline: 0 }}
                onClick={() => {
                  decisionForm.resetFields();
                  setDecision({ row, action: "approve" });
                }}
              >
                Phê duyệt
              </Button>
              <Button
                type="link"
                size="small"
                danger
                style={{ paddingInline: 0 }}
                onClick={() => {
                  decisionForm.resetFields();
                  setDecision({ row, action: "reject" });
                }}
              >
                Từ chối
              </Button>
            </div>
          );
        }
        if (row.status === "APPROVED") {
          return (
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0 }}
              onClick={() => {
                recordForm.resetFields();
                setRecording(row);
              }}
            >
              Ghi nhận thu hồi
            </Button>
          );
        }
        return <Tag>Đã khép lại</Tag>;
      },
    },
  ];

  return (
    <>
      <ListPage<SettlementRecovery>
        title="Thu hồi sau đối soát"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(SETTLEMENT_RECOVERY_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách thu hồi.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có khoản thu hồi chờ xử lý"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1500}
        itemLabel="khoản thu hồi"
      />

      <FormModal
        open={!!decision}
        title={decision?.action === "approve" ? "Phê duyệt thu hồi" : "Từ chối thu hồi"}
        form={decisionForm}
        onCancel={() => {
          setDecision(null);
          decisionForm.resetFields();
        }}
        onSubmit={(values) => {
          if (!decision) return;
          decide.mutate({
            id: decision.row.id,
            action: decision.action,
            note: String(values.note ?? "").trim(),
          });
        }}
        submitting={decide.isPending}
        okText={decision?.action === "approve" ? "Phê duyệt" : "Từ chối"}
        width={540}
      >
        {decision ? (
          <div style={{ marginBottom: 12 }}>
            <p style={{ marginTop: 0 }}>
              <strong>Đối tác:</strong>{" "}
              {decision.row.partner?.name ?? `#${decision.row.partnerId}`}
            </p>
            <p>
              <strong>Số tiền:</strong> {formatMoney(decision.row.amount)}
            </p>
            <p>
              <strong>Lý do:</strong> {decision.row.reason}
            </p>
            <p className="agri-muted" style={{ margin: 0 }}>
              Phê duyệt không tự động trừ tiền. Khoản thu hồi chỉ khép lại khi kế toán ghi
              nhận đã thu/đã trừ kèm mã tham chiếu. Trong lúc chờ, mọi lệnh chi trả của đối
              tác này bị khóa.
            </p>
          </div>
        ) : null}
        <Form.Item
          label="Căn cứ quyết định"
          name="note"
          rules={[{ required: true, whitespace: true, message: "Nhập căn cứ quyết định." }]}
        >
          <Input.TextArea rows={3} placeholder="VD: Kế toán trưởng xác nhận thu hồi qua kỳ sau" />
        </Form.Item>
      </FormModal>

      <FormModal
        open={!!recording}
        title="Ghi nhận đã thu hồi"
        form={recordForm}
        onCancel={() => {
          setRecording(null);
          recordForm.resetFields();
        }}
        onSubmit={(values) => {
          if (!recording) return;
          record.mutate({
            id: recording.id,
            reference: String(values.reference ?? "").trim(),
            note: String(values.note ?? "").trim() || undefined,
          });
        }}
        submitting={record.isPending}
        okText="Ghi nhận"
        width={540}
      >
        {recording ? (
          <div style={{ marginBottom: 12 }}>
            <p style={{ marginTop: 0 }}>
              <strong>Đối tác:</strong> {recording.partner?.name ?? `#${recording.partnerId}`}
            </p>
            <p>
              <strong>Số tiền:</strong> {formatMoney(recording.amount)}
            </p>
          </div>
        ) : null}
        <Form.Item
          label="Mã tham chiếu thu hồi"
          name="reference"
          rules={[{ required: true, whitespace: true, message: "Nhập mã tham chiếu." }]}
          extra="Mã chuyển khoản hoặc mã kỳ đối soát đã trừ khoản này."
        >
          <Input placeholder="VD: FT2610240001 / SET-20261024-0002" />
        </Form.Item>
        <Form.Item label="Ghi chú" name="note">
          <Input.TextArea rows={2} />
        </Form.Item>
      </FormModal>
    </>
  );
}

function PayoutsTab() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const payoutIdempotency = useRef<IdempotencyStore["current"]>(null);
  // Payouts can only be created for CONFIRMED (or already PAID) settlements, so
  // the lookup runs two server-side filtered queries and merges them.
  const confirmed = useListQuery<Settlement>(
    queryKeys.settlements({ status: "CONFIRMED" }),
    resources.settlements,
    { status: "CONFIRMED", limit: 100 },
  );
  const paid = useListQuery<Settlement>(
    queryKeys.settlements({ status: "PAID" }),
    resources.settlements,
    { status: "PAID", limit: 100 },
  );
  const payableSettlements = [...(confirmed.data?.data ?? []), ...(paid.data?.data ?? [])];
  const settlementsLoading = confirmed.isLoading || paid.isLoading;

  const { data, isLoading, isError, refetch } = useListQuery<Payout>(
    queryKeys.payouts(list.params),
    resources.payouts,
    list.params,
  );

  const create = useAction(
    (values: { settlementId: number; amount?: number; reference?: string }) => {
      const body = {
        settlementId: num(values.settlementId),
        amount: num(values.amount),
        reference: values.reference,
      };
      return resources.createPayout(body, idempotencyKeyFor(payoutIdempotency, body));
    },
    {
      invalidate: [["payouts"], ["settlements"]],
      successMessage: "Đã tạo lệnh chi trả.",
      onSuccess: () => {
        payoutIdempotency.current = null;
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
            loading={settlementsLoading}
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
        { key: "adjustments", label: "Điều chỉnh đối soát", children: <AdjustmentsTab /> },
        {
          key: "recoveries",
          label: "Thu hồi sau đối soát",
          children: <RecoveriesTab />,
        },
        { key: "payouts", label: "Chi trả", children: <PayoutsTab /> },
      ]}
    />
  );
}
