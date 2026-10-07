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
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { payoutStatus, settlementStatus } from "@/lib/status";
import type { Payout, Settlement, SettlementLine } from "@/types/api";

export default function SettlementDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: settlement, isLoading, isError, refetch } = useDetailQuery<Settlement>(
    queryKeys.settlement(id),
    () => resources.settlement(id),
  );

  const confirm = useAction(() => resources.confirmSettlement(id), {
    invalidate: [queryKeys.settlement(id), ["settlements"]],
    successMessage: "Đã xác nhận kỳ đối soát.",
  });

  const lineColumns: ColumnsType<SettlementLine> = [
    {
      title: "Đơn đối tác",
      render: (_, row) => (
        <span className="agri-mono">{row.partnerOrder?.code ?? `#${row.partnerOrderId}`}</span>
      ),
    },
    {
      title: "Doanh thu",
      dataIndex: "grossAmount",
      align: "right",
      render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
    },
    {
      title: "Hoàn tiền",
      dataIndex: "refundAmount",
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
  ];

  const payoutColumns: ColumnsType<Payout> = [
    { title: "Lệnh chi trả", dataIndex: "code", render: (v: string) => <span className="agri-mono">{v}</span> },
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
      title: "Chi trả lúc",
      dataIndex: "paidAt",
      render: (v: string | null) => (v ? formatDateTime(v) : "—"),
    },
  ];

  const canConfirm = settlement?.status === "DRAFT";

  return (
    <DetailPage
      title={settlement ? `Đối soát ${settlement.code}` : "Chi tiết đối soát"}
      subtitle={
        settlement
          ? `${settlement.partner?.name ?? ""} · ${formatDate(settlement.periodStart)} – ${formatDate(settlement.periodEnd)}`
          : undefined
      }
      backHref="/settlements"
      backLabel="Danh sách đối soát"
      loading={isLoading}
      error={isError ? new Error("Không tải được kỳ đối soát.") : undefined}
      onRetry={() => void refetch()}
      extra={
        settlement ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusTag status={settlementStatus(settlement.status)} />
            {canConfirm ? (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                Xác nhận
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {settlement ? (
        <>
          <DetailCard title="Tổng hợp">
            <InfoDescriptions
              items={[
                {
                  key: "partner",
                  label: "Đối tác",
                  children: settlement.partner ? (
                    <Link href={`/partners/${settlement.partner.id}`} className="agri-link">
                      {settlement.partner.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { key: "code", label: "Mã đối soát", children: <span className="agri-mono">{settlement.code}</span> },
                { key: "gross", label: "Doanh thu", children: formatMoney(settlement.grossAmount) },
                { key: "refund", label: "Hoàn tiền", children: formatMoney(settlement.refundAmount) },
                { key: "commission", label: "Hoa hồng", children: formatMoney(settlement.commissionAmount) },
                { key: "adjustment", label: "Điều chỉnh", children: formatMoney(settlement.adjustmentAmount) },
                {
                  key: "payable",
                  label: "Phải trả đối tác",
                  children: <strong>{formatMoney(settlement.payableAmount)}</strong>,
                },
                {
                  key: "confirmed",
                  label: "Xác nhận lúc",
                  children: settlement.confirmedAt ? formatDateTime(settlement.confirmedAt) : "—",
                },
              ]}
            />
          </DetailCard>

          <DetailCard title="Chi tiết theo đơn">
            <Table<SettlementLine>
              size="small"
              rowKey="id"
              columns={lineColumns}
              dataSource={settlement.lines ?? []}
              pagination={false}
              locale={{ emptyText: "Không có dòng đối soát" }}
            />
          </DetailCard>

          <DetailCard title="Lệnh chi trả">
            <Table<Payout>
              size="small"
              rowKey="id"
              columns={payoutColumns}
              dataSource={settlement.payouts ?? []}
              pagination={false}
              locale={{ emptyText: "Chưa có lệnh chi trả" }}
            />
          </DetailCard>

          <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            Công thức: Doanh thu − Hoàn tiền − Hoa hồng + Điều chỉnh = Số phải trả đối tác.
          </Typography.Paragraph>
        </>
      ) : null}
    </DetailPage>
  );
}
