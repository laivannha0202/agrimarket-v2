"use client";

/**
 * "Nội bộ": commission -> settlement -> payout, plus post-settlement
 * reconciliation rows.
 *
 * Admin-only data. The customer order PDF and the customer apps never receive
 * these fields.
 */

import { Alert, Table, Typography } from "antd";
import { DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { formatDateTime, formatMoney } from "@/lib/format";
import { orderStatus, payoutStatus, settlementAdjustmentResolution, settlementAdjustmentStatus, settlementStatus } from "@/lib/status";
import type { Order, OrderSettlementAdjustment, PartnerOrder } from "@/types/api";
import { SectionEmpty } from "./shared";

function adjustmentsTable(rows: OrderSettlementAdjustment[]) {
  return (
    <Table<OrderSettlementAdjustment>
      size="small"
      rowKey="id"
      pagination={false}
      scroll={{ x: 640 }}
      dataSource={rows}
      columns={[
        {
          title: "Số tiền",
          dataIndex: "amount",
          width: 130,
          align: "right",
          render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
        },
        {
          title: "Trạng thái",
          dataIndex: "status",
          width: 130,
          render: (s: string) => <StatusTag status={settlementAdjustmentStatus(s)} />,
        },
        {
          title: "Hướng xử lý",
          dataIndex: "resolution",
          width: 150,
          render: (v: string | null) =>
            v ? <StatusTag status={settlementAdjustmentResolution(v)} /> : "—",
        },
        {
          title: "Lý do",
          dataIndex: "reason",
          render: (v: string) => v,
        },
        {
          title: "Ghi chú xử lý",
          dataIndex: "resolutionNote",
          render: (v: string | null) => v ?? "—",
        },
      ]}
    />
  );
}

function PartnerFinanceCard({ partnerOrder }: { partnerOrder: PartnerOrder }) {
  const lines = partnerOrder.settlementLines ?? [];
  const adjustments = partnerOrder.settlementAdjustments ?? [];
  const line = lines[0];

  return (
    <DetailCard
      title={`Đối tác: ${partnerOrder.partner?.name ?? partnerOrder.code}`}
      extra={<StatusTag status={orderStatus(partnerOrder.status)} />}
    >
      <InfoDescriptions
        column={{ xs: 1, sm: 2, md: 4 }}
        items={[
          { key: "subtotal", label: "Tạm tính", children: formatMoney(partnerOrder.subtotal) },
          {
            key: "discount",
            label: "Giảm giá",
            children: formatMoney(partnerOrder.discountTotal),
          },
          {
            key: "commission",
            label: "Hoa hồng",
            children: formatMoney(partnerOrder.commissionAmount),
          },
          {
            key: "payable",
            label: "Phải trả đối tác",
            children: <strong>{formatMoney(partnerOrder.payableAmount)}</strong>,
          },
        ]}
      />

      <div style={{ height: 16 }} />
      {line?.settlement ? (
        <>
          <Typography.Text strong>Quyết toán</Typography.Text>
          <div style={{ height: 8 }} />
          <InfoDescriptions
            column={{ xs: 1, sm: 2, md: 3 }}
            items={[
              {
                key: "code",
                label: "Mã quyết toán",
                children: <span className="agri-mono">{line.settlement.code}</span>,
              },
              {
                key: "status",
                label: "Trạng thái",
                children: <StatusTag status={settlementStatus(line.settlement.status)} />,
              },
              {
                key: "confirmedAt",
                label: "Xác nhận lúc",
                children: formatDateTime(line.settlement.confirmedAt),
              },
              {
                key: "gross",
                label: "Doanh thu ghi nhận",
                children: formatMoney(line.grossAmount),
              },
              {
                key: "refund",
                label: "Hoàn tiền đã trừ",
                children: formatMoney(line.refundAmount),
              },
              {
                key: "linePayable",
                label: "Dòng phải trả",
                children: <strong>{formatMoney(line.payableAmount)}</strong>,
              },
              {
                key: "settlementPayable",
                label: "Tổng phải trả kỳ",
                children: formatMoney(line.settlement.payableAmount),
              },
              {
                key: "settlementAdjustment",
                label: "Điều chỉnh kỳ",
                children: formatMoney(line.settlement.adjustmentAmount),
              },
            ]}
          />

          <div style={{ height: 12 }} />
          <Typography.Text strong>Chi trả</Typography.Text>
          <Table
            size="small"
            rowKey="id"
            style={{ marginTop: 8 }}
            pagination={false}
            scroll={{ x: 560 }}
            dataSource={line.settlement.payouts ?? []}
            locale={{ emptyText: <SectionEmpty text="Chưa có lệnh chi trả." /> }}
            columns={[
              {
                title: "Mã",
                dataIndex: "code",
                render: (v: string) => <span className="agri-mono">{v}</span>,
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
                title: "Tham chiếu",
                dataIndex: "reference",
                render: (v: string | null) => v ?? "—",
              },
              {
                title: "Chi lúc",
                dataIndex: "paidAt",
                render: (v: string | null) => formatDateTime(v),
              },
            ]}
          />
        </>
      ) : (
        <SectionEmpty text="Đơn đối tác này chưa được đưa vào kỳ quyết toán nào." />
      )}

      <div style={{ height: 16 }} />
      <Typography.Text strong>Điều chỉnh sau quyết toán</Typography.Text>
      <div style={{ marginTop: 8 }}>
        {adjustments.length > 0 ? (
          adjustmentsTable(adjustments)
        ) : (
          <SectionEmpty text="Không có điều chỉnh." />
        )}
      </div>
    </DetailCard>
  );
}

export function OrderFinanceTab({ order }: { order: Order }) {
  const partnerOrders = order.partnerOrders ?? [];
  if (partnerOrders.length === 0) {
    return (
      <DetailCard title="Tài chính nội bộ">
        <SectionEmpty text="Đơn hàng chưa có đối tác." />
      </DetailCard>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="Số liệu nội bộ"
        description="Hoa hồng, quyết toán và chi trả chỉ hiển thị trong trang quản trị. Khách hàng và phiếu PDF dành cho khách không nhận các trường này."
      />
      {partnerOrders.map((po) => (
        <PartnerFinanceCard key={po.id} partnerOrder={po} />
      ))}
    </div>
  );
}
