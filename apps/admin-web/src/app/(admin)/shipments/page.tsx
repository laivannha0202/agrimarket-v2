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
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime } from "@/lib/format";
import { SHIPMENT_STATUS, shipmentStatus, statusOptions } from "@/lib/status";
import type { Shipment } from "@/types/api";

/**
 * Allowed shipment transitions, mirroring the backend state machine.
 * In-transit cancellation becomes RETURNING (the parcel must come back
 * through quarantine); only a parcel still at the warehouse can be CANCELLED.
 */
const SHIPMENT_TRANSITIONS: Record<string, { value: string; label: string }[]> = {
  PENDING: [
    { value: "READY", label: "Sẵn sàng giao" },
    { value: "IN_TRANSIT", label: "Bắt đầu vận chuyển" },
    { value: "CANCELLED", label: "Hủy (chưa giao cho đơn vị vận chuyển)" },
  ],
  READY: [
    { value: "IN_TRANSIT", label: "Bắt đầu vận chuyển" },
    { value: "CANCELLED", label: "Hủy (chưa giao cho đơn vị vận chuyển)" },
  ],
  IN_TRANSIT: [
    { value: "OUT_FOR_DELIVERY", label: "Đang giao đến khách" },
    { value: "DELIVERY_FAILED", label: "Giao thất bại" },
    { value: "RETURNING", label: "Hoàn hàng về kho" },
  ],
  OUT_FOR_DELIVERY: [
    { value: "DELIVERED", label: "Giao thành công" },
    { value: "DELIVERY_FAILED", label: "Giao thất bại" },
    { value: "RETURNING", label: "Hoàn hàng về kho" },
  ],
  DELIVERY_FAILED: [{ value: "RETURNING", label: "Hoàn hàng về kho" }],
  RETURNING: [{ value: "RETURNED", label: "Đã nhận hàng hoàn" }],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
};

export default function ShipmentsPage() {
  const list = useListState();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [createForm] = Form.useForm();
  const [updateForm] = Form.useForm();

  const { data, isLoading, isError, refetch } = useListQuery<Shipment>(
    queryKeys.shipments(list.params),
    resources.shipments,
    list.params,
  );

  const create = useAction(
    (values: { partnerOrderId: number; carrier?: string; trackingCode?: string }) =>
      resources.createShipment({
        partnerOrderId: Number(values.partnerOrderId),
        carrier: values.carrier?.trim() || undefined,
        trackingCode: values.trackingCode?.trim() || undefined,
      }),
    {
      invalidate: [["shipments"], ["orders"]],
      successMessage: "Đã tạo vận đơn.",
      onSuccess: () => {
        setCreateOpen(false);
        createForm.resetFields();
      },
    },
  );

  const update = useAction(
    (values: { status: string; note?: string; failureReason?: string }) => {
      if (!editing) throw new Error("Chưa chọn vận đơn.");
      return resources.updateShipmentStatus(editing.id, {
        status: values.status,
        note: values.note?.trim() || undefined,
        failureReason: values.failureReason?.trim() || undefined,
      });
    },
    {
      invalidate: [["shipments"], ["orders"], ["quarantine-cases"]],
      successMessage: "Đã cập nhật vận đơn.",
      onSuccess: () => {
        setEditing(null);
        updateForm.resetFields();
      },
    },
  );

  const nextStatus = Form.useWatch("status", updateForm);

  const columns: ColumnsType<Shipment> = [
    {
      title: "Mã vận đơn",
      dataIndex: "code",
      render: (code: string) => <span className="agri-mono agri-nowrap">{code}</span>,
    },
    {
      title: "Đơn hàng",
      render: (_, row) =>
        row.partnerOrder?.order ? (
          <Link href={`/orders/${row.partnerOrder.order.id}`} className="agri-link agri-nowrap">
            {row.partnerOrder.order.code}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      title: "Đối tác",
      render: (_, row) => row.partnerOrder?.partner?.name ?? "—",
    },
    {
      title: "Vận chuyển",
      render: (_, row) => (
        <div>
          <div>{row.carrier ?? "—"}</div>
          <div className="agri-muted agri-mono" style={{ fontSize: 12 }}>
            {row.trackingCode ?? ""}
          </div>
        </div>
      ),
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={shipmentStatus(s)} />,
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
        (SHIPMENT_TRANSITIONS[row.status] ?? []).length > 0 ? (
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0 }}
            onClick={() => {
              setEditing(row);
              updateForm.resetFields();
              updateForm.setFieldsValue({ status: (SHIPMENT_TRANSITIONS[row.status] ?? [])[0]?.value });
            }}
          >
            Cập nhật
          </Button>
        ) : (
          <span className="agri-muted">Đã kết thúc</span>
        ),
    },
  ];

  return (
    <>
      <ListPage<Shipment>
        title="Vận đơn"
        subtitle="Tạo vận đơn chỉ khi đơn hàng và đơn đối tác đều ở trạng thái Chờ giao. Giao thành công không tự thu COD — xác nhận thu tiền tại mục Thanh toán."
        searchValue={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Tìm theo mã vận đơn, mã đơn hàng..."
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(SHIPMENT_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Tạo vận đơn
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách vận đơn.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có vận đơn phù hợp"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1040}
        itemLabel="vận đơn"
      />

      <FormModal
        open={createOpen}
        title="Tạo vận đơn"
        form={createForm}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        onSubmit={(values) => create.mutate(values as never)}
        submitting={create.isPending}
      >
        <Form.Item
          label="ID đơn đối tác"
          name="partnerOrderId"
          rules={[{ required: true, message: "Nhập ID đơn đối tác." }]}
          extra="Đơn hàng và đơn đối tác phải đang ở trạng thái Chờ giao (READY_TO_SHIP)."
        >
          <Input type="number" placeholder="VD: 12" />
        </Form.Item>
        <Form.Item label="Đơn vị vận chuyển" name="carrier">
          <Input placeholder="VD: GHN, GHTK, Viettel Post" />
        </Form.Item>
        <Form.Item label="Mã vận đơn" name="trackingCode">
          <Input placeholder="Mã tra cứu của đơn vị vận chuyển" />
        </Form.Item>
      </FormModal>

      <FormModal
        open={!!editing}
        title="Cập nhật vận đơn"
        form={updateForm}
        onCancel={() => {
          setEditing(null);
          updateForm.resetFields();
        }}
        onSubmit={(values) => update.mutate(values as never)}
        submitting={update.isPending}
      >
        {editing ? (
          <p style={{ marginTop: 0 }}>
            <strong>{editing.code}</strong> — hiện tại:{" "}
            <StatusTag status={shipmentStatus(editing.status)} />
          </p>
        ) : null}
        <Form.Item
          label="Trạng thái mới"
          name="status"
          rules={[{ required: true, message: "Chọn trạng thái." }]}
        >
          <Select
            options={editing ? SHIPMENT_TRANSITIONS[editing.status] ?? [] : []}
            placeholder="Chọn trạng thái"
          />
        </Form.Item>
        {nextStatus === "DELIVERY_FAILED" ? (
          <Form.Item label="Lý do giao thất bại" name="failureReason">
            <Input placeholder="VD: Khách không nhận hàng" />
          </Form.Item>
        ) : null}
        <Form.Item label="Ghi chú" name="note">
          <Input.TextArea rows={2} placeholder="Ghi chú xử lý (tùy chọn)" />
        </Form.Item>
        {nextStatus === "RETURNING" || nextStatus === "RETURNED" ? (
          <p className="agri-muted" style={{ margin: 0 }}>
            Hàng hoàn về sẽ được chuyển sang khu cách ly và phải kiểm định lại trước khi
            bán tiếp. Không có trường hợp nào tự động giải phóng hàng.
          </p>
        ) : null}
        {nextStatus === "CANCELLED" ? (
          <p className="agri-muted" style={{ margin: 0 }}>
            Chỉ hủy được khi hàng chưa giao cho đơn vị vận chuyển.
          </p>
        ) : null}
      </FormModal>
    </>
  );
}
