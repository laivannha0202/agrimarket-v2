"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleOutlined } from "@ant-design/icons";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { warehouseDocStatus, warehouseDocType } from "@/lib/status";
import type { WarehouseDocument, WarehouseDocumentLine } from "@/types/api";

export default function WarehouseDocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: doc, isLoading, isError, refetch } = useDetailQuery<WarehouseDocument>(
    queryKeys.warehouseDocument(id),
    () => resources.warehouseDocument(id),
  );

  const complete = useAction(() => resources.completeWarehouseDocument(id), {
    invalidate: [queryKeys.warehouseDocument(id), ["warehouse-documents"], ["inventory"], ["movements"]],
    successMessage: "Đã hoàn thành phiếu kho và cập nhật tồn kho.",
  });

  const lineColumns: ColumnsType<WarehouseDocumentLine> = [
    {
      title: "Lô hàng",
      dataIndex: "productLotId",
      render: (v: number) => (
        <Link href={`/lots/${v}`} className="agri-link agri-mono">
          #{v}
        </Link>
      ),
    },
    {
      title: "Biến thể",
      dataIndex: "productVariantId",
      render: (v: number) => <span className="agri-mono">#{v}</span>,
    },
    {
      title: "Số lượng",
      dataIndex: "quantity",
      align: "right",
      render: (v: string, row) => <span className="agri-nowrap">{formatQuantity(v, row.unit)}</span>,
    },
  ];

  const canComplete = doc?.status === "DRAFT";

  return (
    <DetailPage
      title={doc ? `Phiếu kho ${doc.code}` : "Chi tiết phiếu kho"}
      subtitle={doc ? `Tạo lúc ${formatDateTime(doc.createdAt)}` : undefined}
      backHref="/warehouse-documents"
      backLabel="Danh sách phiếu kho"
      loading={isLoading}
      error={isError ? new Error("Không tải được phiếu kho.") : undefined}
      onRetry={() => void refetch()}
      extra={
        doc ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusTag status={warehouseDocStatus(doc.status)} />
            {canComplete ? (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={complete.isPending}
                onClick={() => complete.mutate()}
              >
                Hoàn thành phiếu
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {doc ? (
        <>
          <DetailCard title="Thông tin phiếu">
            <InfoDescriptions
              items={[
                { key: "code", label: "Mã phiếu", children: <span className="agri-mono">{doc.code}</span> },
                { key: "type", label: "Loại phiếu", children: <StatusTag status={warehouseDocType(doc.type)} /> },
                { key: "warehouse", label: "Kho", children: doc.warehouse?.name ?? "—" },
                {
                  key: "source",
                  label: "Nguồn",
                  children: doc.sourceType ? `${doc.sourceType} #${doc.sourceId ?? ""}` : "—",
                },
                {
                  key: "completed",
                  label: "Hoàn thành lúc",
                  children: doc.completedAt ? formatDateTime(doc.completedAt) : "—",
                },
                { key: "note", label: "Ghi chú", span: 2, children: doc.note ?? "—" },
              ]}
            />
          </DetailCard>

          <DetailCard title="Dòng hàng">
            <Table<WarehouseDocumentLine>
              size="small"
              rowKey="id"
              columns={lineColumns}
              dataSource={doc.lines ?? []}
              pagination={false}
              locale={{ emptyText: "Không có dòng hàng" }}
            />
          </DetailCard>

          <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            Hoàn thành phiếu sẽ áp dụng thay đổi tồn kho và không thể hoàn tác.
          </Typography.Paragraph>
        </>
      ) : null}
    </DetailPage>
  );
}
