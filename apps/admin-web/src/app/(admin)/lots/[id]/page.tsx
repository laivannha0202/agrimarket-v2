"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Form, Input, Table, Timeline, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { WarningOutlined } from "@ant-design/icons";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import {
  lotStatus,
  qcResult,
  traceEventType,
  inventoryMovementType,
} from "@/lib/status";
import type {
  InventoryBalance,
  InventoryMovement,
  ProductLot,
  QcInspection,
  TraceEvent,
} from "@/types/api";

export default function LotDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [recallOpen, setRecallOpen] = useState(false);
  const [form] = Form.useForm();

  const { data: lot, isLoading, isError, refetch } = useDetailQuery<ProductLot>(
    queryKeys.lot(id),
    () => resources.lot(id),
  );

  const recall = useAction((reason: string) => resources.recallLot(id, reason), {
    invalidate: [queryKeys.lot(id), ["lots"]],
    successMessage: "Đã thu hồi lô hàng.",
    onSuccess: () => {
      setRecallOpen(false);
      form.resetFields();
    },
  });

  const qcColumns: ColumnsType<QcInspection> = [
    {
      title: "Kết quả",
      dataIndex: "result",
      render: (r: string) => <StatusTag status={qcResult(r)} />,
    },
    {
      title: "Tiêu chí",
      render: (_, row) => {
        const items = [
          ["Ngoại hình", row.appearancePassed],
          ["Độ tươi", row.freshnessPassed],
          ["Hư hỏng", row.damagePassed],
        ] as const;
        return (
          <span className="agri-muted" style={{ fontSize: 12 }}>
            {items.map(([label, ok]) => `${label}: ${ok ? "Đạt" : "Không"}`).join(" · ")}
            {row.packagingPassed !== null ? ` · Đóng gói: ${row.packagingPassed ? "Đạt" : "Không"}` : ""}
          </span>
        );
      },
    },
    { title: "Người kiểm định", render: (_, row) => row.inspectorUser?.fullName ?? "—" },
    {
      title: "Thời điểm",
      dataIndex: "inspectedAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    { title: "Ghi chú", dataIndex: "note", render: (v: string | null) => v ?? "—" },
  ];

  const balanceColumns: ColumnsType<InventoryBalance> = [
    { title: "Kho", render: (_, row) => row.warehouse?.name ?? "—" },
    { title: "Biến thể", render: (_, row) => row.productVariant?.name ?? "—" },
    {
      title: "Tồn thực tế",
      dataIndex: "onHand",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
    },
    {
      title: "Đã giữ",
      dataIndex: "reserved",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
    },
    {
      title: "Khả dụng",
      dataIndex: "available",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
    },
  ];

  // /inventory/movements does not support a productLotId filter (rejected by
  // the API), so we fetch the recent movements and select this lot's rows.
  const movements = useDetailQuery<{ data: InventoryMovement[] }>(
    ["movements", "lot", String(id)],
    async () => {
      const res = await resources.movements({ limit: 100 });
      return { data: res.data.filter((m) => String(m.productLotId) === String(id)) };
    },
    !!lot,
  );

  const canRecall = lot ? lot.status !== "RECALLED" : false;

  return (
    <DetailPage
      title={lot ? `Lô ${lot.code}` : "Chi tiết lô hàng"}
      subtitle={lot ? `Mã truy xuất: ${lot.traceCode}` : undefined}
      backHref="/lots"
      backLabel="Danh sách lô hàng"
      loading={isLoading}
      error={isError ? new Error("Không tải được lô hàng.") : undefined}
      onRetry={() => void refetch()}
      extra={
        lot ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusTag status={lotStatus(lot.status)} />
            {canRecall ? (
              <Button danger icon={<WarningOutlined />} onClick={() => setRecallOpen(true)}>
                Thu hồi lô
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {lot ? (
        <>
          <DetailCard title="Thông tin lô">
            <InfoDescriptions
              items={[
                {
                  key: "product",
                  label: "Sản phẩm",
                  children: lot.product ? (
                    <Link href={`/products/${lot.product.id}`} className="agri-link">
                      {lot.product.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { key: "grade", label: "Phân loại", children: lot.grade },
                {
                  key: "quantity",
                  label: "Số lượng",
                  children: formatQuantity(lot.quantity, lot.unit),
                },
                {
                  key: "remaining",
                  label: "Còn lại",
                  children: formatQuantity(lot.remainingQuantity, lot.unit),
                },
                { key: "expires", label: "Hết hạn", children: formatDate(lot.expiresAt) },
                {
                  key: "packed",
                  label: "Đóng gói",
                  children: lot.packedAt ? formatDate(lot.packedAt) : "—",
                },
                {
                  key: "partner",
                  label: "Đối tác",
                  children: lot.product?.partner ? (
                    <Link href={`/partners/${lot.product.partner.id}`} className="agri-link">
                      {lot.product.partner.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                {
                  key: "farm",
                  label: "Trang trại",
                  children: lot.harvest?.season?.farm ? (
                    <Link href={`/farms/${lot.harvest.season.farm.id}`} className="agri-link">
                      {lot.harvest.season.farm.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
          </DetailCard>

          <DetailCard title="Kiểm định chất lượng">
            <Table<QcInspection>
              size="small"
              rowKey="id"
              columns={qcColumns}
              dataSource={lot.qcInspections ?? []}
              pagination={false}
              locale={{ emptyText: "Chưa có phiếu kiểm định" }}
            />
          </DetailCard>

          <DetailCard title="Tồn kho">
            <Table<InventoryBalance>
              size="small"
              rowKey="id"
              columns={balanceColumns}
              dataSource={lot.inventoryBalances ?? []}
              pagination={false}
              locale={{ emptyText: "Chưa có tồn kho" }}
            />
          </DetailCard>

          <DetailCard title="Lịch sử truy xuất">
            {lot.traceEvents && lot.traceEvents.length > 0 ? (
              <Timeline
                items={lot.traceEvents.map((e: TraceEvent) => ({
                  color: "green",
                  children: (
                    <div>
                      <div style={{ fontWeight: 500 }}>
                        {traceEventType(e.type).label}{" "}
                        <span className="agri-muted agri-nowrap" style={{ fontWeight: 400 }}>
                          {formatDateTime(e.occurredAt)}
                        </span>
                      </div>
                      {e.description ? (
                        <div className="agri-muted" style={{ fontSize: 12 }}>
                          {e.description}
                        </div>
                      ) : null}
                    </div>
                  ),
                }))}
              />
            ) : (
              <Typography.Text type="secondary">Chưa có sự kiện truy xuất.</Typography.Text>
            )}
          </DetailCard>

          <DetailCard title="Biến động kho">
            <Table<InventoryMovement>
              size="small"
              rowKey="id"
              loading={movements.isLoading}
              columns={[
                {
                  title: "Loại",
                  dataIndex: "type",
                  render: (t: string) => <StatusTag status={inventoryMovementType(t)} />,
                },
                {
                  title: "Thay đổi",
                  dataIndex: "quantityDelta",
                  align: "right",
                  render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
                },
                {
                  title: "Trước",
                  dataIndex: "beforeQuantity",
                  align: "right",
                  render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
                },
                {
                  title: "Sau",
                  dataIndex: "afterQuantity",
                  align: "right",
                  render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
                },
                {
                  title: "Thời điểm",
                  dataIndex: "createdAt",
                  render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
                },
              ]}
              dataSource={movements.data?.data ?? []}
              pagination={false}
              locale={{ emptyText: "Chưa có biến động kho" }}
            />
          </DetailCard>

          <FormModal
            open={recallOpen}
            title="Thu hồi lô hàng"
            form={form}
            onCancel={() => setRecallOpen(false)}
            onSubmit={(values) => recall.mutate(String(values.reason ?? ""))}
            submitting={recall.isPending}
            okText="Thu hồi"
          >
            <Form.Item
              label="Lý do thu hồi"
              name="reason"
              rules={[{ required: true, message: "Nhập lý do thu hồi." }]}
            >
              <Input.TextArea rows={3} placeholder="VD: Phát hiện dư lượng thuốc bảo vệ thực vật vượt ngưỡng" />
            </Form.Item>
          </FormModal>
        </>
      ) : null}
    </DetailPage>
  );
}
