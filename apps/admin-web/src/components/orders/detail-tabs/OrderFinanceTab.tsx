"use client";

/**
 * "Nội bộ": commission -> settlement -> payout, plus post-settlement
 * reconciliation rows.
 *
 * Admin-only data. The customer order PDF and the customer apps never receive
 * these fields.
 */

import { Alert, Collapse, Table, Tooltip, Typography } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
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
  const commissionLabel = line ? "Hoa hồng đã ghi nhận" : "Hoa hồng dự kiến";
  const payableLabel = line ? "Đã quyết toán" : "Phải trả dự kiến";

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
            label: commissionLabel,
            children: formatMoney(partnerOrder.commissionAmount),
          },
          {
            key: "payable",
            label: payableLabel,
            children: <strong>{formatMoney(partnerOrder.payableAmount)}</strong>,
          },
        ]}
      />

      <div style={{ height: 12 }} />
      {line?.settlement ? (
        <>
          <Collapse
            items={[
              {
                key: "settlement",
                label: "Chi tiết quyết toán",
                children: (
                  <>
                    <InfoDescriptions
                      column={{ xs: 1, sm: 2, md: 3 }}
                      items={[
                        {
                          key: "code",
                          label: "Mã kỳ quyết toán",
                          children: <span className="agri-mono">{line.settlement.code}</span>,
                        },
                        {
                          key: "status",
                          label: "Trạng thái quyết toán",
                          children: <StatusTag status={settlementStatus(line.settlement.status)} />,
                        },
                        {
                          key: "confirmedAt",
                          label: "Xác nhận lúc",
                          children: formatDateTime(line.settlement.confirmedAt),
                        },
                        {
                          key: "gross",
                          label: "Doanh thu ghi nhận (đơn)",
                          children: formatMoney(line.grossAmount),
                        },
                        {
                          key: "refund",
                          label: "Hoàn tiền đã trừ (đơn)",
                          children: formatMoney(line.refundAmount),
                        },
                        {
                          key: "linePayable",
                          label: "Dòng phải trả (đơn)",
                          children: <strong>{formatMoney(line.payableAmount)}</strong>,
                        },
                        {
                          key: "settlementPayable",
                          label: "Tổng phải trả cả kỳ",
                          children: formatMoney(line.settlement.payableAmount),
                        },
                        {
                          key: "settlementAdjustment",
                          label: "Điều chỉnh kỳ",
                          children: formatMoney(line.settlement.adjustmentAmount),
                        },
                      ]}
                    />
                    <div style={{ marginTop: 12 }}>
                      <Typography.Text strong>Chi trả</Typography.Text>
                      <div style={{ fontSize: 12, marginTop: 4 }} className="agri-muted">
                        Các lệnh chi trả thuộc cả kỳ quyết toán, không phải riêng đơn này.
                      </div>
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
                    </div>
                  </>
                ),
              },
            ]}
          />
        </>
      ) : (
        <div style={{ fontSize: 13 }} className="agri-muted">
          Chưa có kỳ quyết toán.
        </div>
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
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }} className="agri-muted">
        <Tooltip title="Hoa hồng, quyết toán và chi trả chỉ hiển thị trong trang quản trị. Khách hàng và phiếu PDF dành cho khách không nhận các trường này.">
          <InfoCircleOutlined />
        </Tooltip>
        <span>Số liệu nội bộ — chỉ quản trị viên.</span>
      </div>
      {order.status === "CANCELLED" ? (
        <Alert
          type="warning"
          showIcon
          title="Đơn đã hủy — số liệu đối tác chỉ để tham chiếu"
          description="Hoa hồng và số phải trả dưới đây vẫn giữ giá trị tính trên đơn gốc, không phải công nợ hiệu lực. Chỉ chi trả khi có kỳ quyết toán đã xác nhận và đã trừ mọi khoản hoàn/điều chỉnh."
        />
      ) : null}
      {partnerOrders.map((po) => (
        <PartnerFinanceCard key={po.id} partnerOrder={po} />
      ))}
    </div>
  );
}