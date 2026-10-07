"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form, Input, Modal, Select, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatQuantity, formatMoney } from "@/lib/format";
import {
  RETURN_STATUS,
  returnStatus,
  statusOptions,
  COMPLAINT_STATUS,
  complaintStatus,
  complaintType,
  refundStatus,
} from "@/lib/status";
import type { Complaint, ReturnRequest } from "@/types/api";

/** Allowed return transitions, mirroring the backend flow. */
const RETURN_TRANSITIONS: Record<string, { value: string; label: string }[]> = {
  REQUESTED: [
    { value: "APPROVED", label: "Chấp nhận" },
    { value: "REJECTED", label: "Từ chối" },
  ],
  APPROVED: [{ value: "RETURNING", label: "Bắt đầu hoàn hàng" }],
  RETURNING: [{ value: "RECEIVED", label: "Đã nhận hàng" }],
  RECEIVED: [{ value: "QC_PENDING", label: "Chờ kiểm định" }],
  QC_PENDING: [{ value: "REFUNDED", label: "Hoàn tiền" }],
  REFUNDED: [],
  REJECTED: [],
};

function ReturnsTab() {
  const list = useListState();
  const [editing, setEditing] = useState<ReturnRequest | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading, isError, refetch } = useListQuery<ReturnRequest>(
    queryKeys.returns(list.params),
    resources.returns,
    list.params,
  );

  const update = useAction(
    (vars: { id: number; status: string; refundId?: number }) =>
      resources.updateReturn(vars.id, { status: vars.status, refundId: vars.refundId }),
    {
      invalidate: [["returns"]],
      successMessage: "Đã cập nhật yêu cầu trả hàng.",
      onSuccess: () => setEditing(null),
    },
  );

  const columns: ColumnsType<ReturnRequest> = [
    {
      title: "Đơn hàng",
      render: (_, row) => (
        <Link href={`/orders/${row.orderId}`} className="agri-link agri-nowrap">
          {row.order?.code ?? `#${row.orderId}`}
        </Link>
      ),
    },
    {
      title: "Số lượng",
      dataIndex: "quantity",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
    },
    { title: "Lý do", dataIndex: "reason", ellipsis: true },
    {
      title: "Hoàn tiền",
      render: (_, row) =>
        row.refund ? (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span className="agri-nowrap">{formatMoney(row.refund.amount)}</span>
            <StatusTag status={refundStatus(row.refund.status)} />
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={returnStatus(s)} />,
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
        (RETURN_TRANSITIONS[row.status] ?? []).length > 0 ? (
          <Button type="link" size="small" onClick={() => setEditing(row)} style={{ paddingInline: 0 }}>
            Xử lý
          </Button>
        ) : (
          <Tag>Đã kết thúc</Tag>
        ),
    },
  ];

  const transitions = editing ? RETURN_TRANSITIONS[editing.status] ?? [] : [];
  const nextStatus = Form.useWatch("status", form);

  return (
    <>
      <ListPage<ReturnRequest>
        title="Trả hàng"
        subtitle="Yêu cầu trả hàng của khách"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(RETURN_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách trả hàng.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có yêu cầu trả hàng"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={960}
        itemLabel="yêu cầu"
      />

      <Modal
        open={!!editing}
        title="Xử lý yêu cầu trả hàng"
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={update.isPending}
        okText="Xác nhận"
        cancelText="Hủy"
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(values: { status: string; refundId?: number }) => {
            if (!editing) return;
            update.mutate({ id: editing.id, status: values.status, refundId: values.refundId });
          }}
        >
          <Form.Item label="Trạng thái mới" name="status" rules={[{ required: true, message: "Chọn trạng thái." }]}>
            <Select options={transitions} placeholder="Chọn trạng thái" />
          </Form.Item>
          {nextStatus === "REFUNDED" && !editing?.refundId ? (
            <Form.Item
              label="Mã hoàn tiền"
              name="refundId"
              rules={[{ required: true, message: "Nhập mã hoàn tiền để chuyển sang Đã hoàn tiền." }]}
            >
              <Input type="number" placeholder="ID giao dịch hoàn tiền" />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </>
  );
}

/** Allowed complaint transitions, mirroring the backend flow. */
const COMPLAINT_TRANSITIONS: Record<string, { value: string; label: string }[]> = {
  OPEN: [
    { value: "PROCESSING", label: "Bắt đầu xử lý" },
    { value: "REJECTED", label: "Từ chối" },
  ],
  PROCESSING: [
    { value: "RESOLVED", label: "Đã giải quyết" },
    { value: "REJECTED", label: "Từ chối" },
  ],
  RESOLVED: [],
  REJECTED: [],
};

function ComplaintsTab() {
  const list = useListState();
  const [editing, setEditing] = useState<Complaint | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading, isError, refetch } = useListQuery<Complaint>(
    queryKeys.complaints(list.params),
    resources.complaints,
    list.params,
  );

  const update = useAction(
    (vars: { id: number; status: string; resolution?: string }) =>
      resources.updateComplaint(vars.id, { status: vars.status, resolution: vars.resolution }),
    {
      invalidate: [["complaints"]],
      successMessage: "Đã cập nhật khiếu nại.",
      onSuccess: () => setEditing(null),
    },
  );

  const columns: ColumnsType<Complaint> = [
    {
      title: "Đơn hàng",
      render: (_, row) => (
        <Link href={`/orders/${row.orderId}`} className="agri-link agri-nowrap">
          {row.order?.code ?? `#${row.orderId}`}
        </Link>
      ),
    },
    {
      title: "Khách hàng",
      render: (_, row) => row.customer?.fullName ?? "—",
    },
    {
      title: "Loại",
      dataIndex: "type",
      render: (t: string) => <StatusTag status={complaintType(t)} />,
    },
    { title: "Nội dung", dataIndex: "content", ellipsis: true },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={complaintStatus(s)} />,
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
        (COMPLAINT_TRANSITIONS[row.status] ?? []).length > 0 ? (
          <Button type="link" size="small" onClick={() => setEditing(row)} style={{ paddingInline: 0 }}>
            Xử lý
          </Button>
        ) : (
          <Tag>Đã kết thúc</Tag>
        ),
    },
  ];

  const transitions = editing ? COMPLAINT_TRANSITIONS[editing.status] ?? [] : [];

  return (
    <>
      <ListPage<Complaint>
        title="Khiếu nại"
        subtitle="Khiếu nại của khách hàng"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(COMPLAINT_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách khiếu nại.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có khiếu nại"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1040}
        itemLabel="khiếu nại"
      />

      <Modal
        open={!!editing}
        title="Xử lý khiếu nại"
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={update.isPending}
        okText="Xác nhận"
        cancelText="Hủy"
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ status: transitions[0]?.value }}
          onFinish={(values: { status: string; resolution?: string }) => {
            if (!editing) return;
            update.mutate({ id: editing.id, status: values.status, resolution: values.resolution });
          }}
        >
          <Form.Item label="Trạng thái mới" name="status" rules={[{ required: true, message: "Chọn trạng thái." }]}>
            <Select options={transitions} placeholder="Chọn trạng thái" />
          </Form.Item>
          <Form.Item label="Hướng giải quyết" name="resolution">
            <Input.TextArea rows={3} placeholder="Ghi chú hướng giải quyết (tùy chọn)" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function ReturnsComplaintsPage() {
  return (
    <Tabs
      defaultActiveKey="returns"
      items={[
        { key: "returns", label: "Trả hàng", children: <ReturnsTab /> },
        { key: "complaints", label: "Khiếu nại", children: <ComplaintsTab /> },
      ]}
    />
  );
}
