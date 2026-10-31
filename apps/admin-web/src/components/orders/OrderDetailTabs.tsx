"use client";

/**
 * Tab bodies for the admin order detail page.
 *
 * Each section answers one operational question and reads ONLY the stored
 * order payload:
 *
 *   Tổng quan   — who ordered, who receives, where and when
 *   Sản phẩm    — what was sold, grouped by the partner that fulfils it
 *   Thanh toán  — what must be collected, what was collected, what came back
 *   Vận chuyển  — how the parcel moves and where it failed
 *   Nội bộ      — commission -> settlement -> payout, plus reconciliation
 *
 * Amounts are never recomputed from catalogue data: `grandTotal`,
 * `unitPriceSnapshot`, `subtotal` and the settlement rows are the snapshots the
 * backend wrote. The only derived figures are explicit "collected / refunded /
 * outstanding" sums over those stored payments and refunds.
 */

import Link from "next/link";
import { Alert, Col, Empty, Row, Table, Tag, Timeline, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DetailCard } from "@/components/common/DetailPage";
import { InfoDescriptions, formatAddress } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import {
  fulfillmentStatus,
  orderStatus,
  paymentMethod,
  paymentStatus,
  payoutStatus,
  refundStatus,
  settlementAdjustmentResolution,
  settlementAdjustmentStatus,
  settlementStatus,
  shipmentStatus,
} from "@/lib/status";
import type {
  Order,
  OrderItem,
  OrderSettlementAdjustment,
  PartnerOrder,
  Payment,
  Shipment,
} from "@/types/api";

/** Unit shown next to a quantity; the snapshot itself has no unit column. */
function itemUnit(item: OrderItem): string | null {
  const variant = item.productVariant;
  return variant?.saleUnit ?? variant?.weightUnit ?? null;
}

const itemColumns: ColumnsType<OrderItem> = [
  {
    title: "STT",
    key: "index",
    width: 56,
    render: (_v, _r, index) => <span className="agri-muted">{index + 1}</span>,
  },
  {
    title: "Sản phẩm",
    dataIndex: "productNameSnapshot",
    render: (_v, row) => (
      <div>
        <div style={{ fontWeight: 500 }}>{row.productNameSnapshot}</div>
        <div className="agri-mono agri-muted" style={{ fontSize: 12 }}>
          {row.skuSnapshot}
        </div>
      </div>
    ),
  },
  {
    title: "ĐVT",
    key: "unit",
    width: 80,
    render: (_v, row) => itemUnit(row) ?? "—",
  },
  {
    title: "SL",
    dataIndex: "quantity",
    width: 90,
    align: "right",
    render: (v: string) => <span className="agri-nowrap">{formatQuantity(v)}</span>,
  },
  {
    title: "Đơn giá",
    dataIndex: "unitPriceSnapshot",
    width: 130,
    align: "right",
    render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
  },
  {
    title: "Thành tiền",
    dataIndex: "subtotal",
    width: 140,
    align: "right",
    render: (v: string) => (
      <strong className="agri-nowrap">{formatMoney(v)}</strong>
    ),
  },
];

function SectionEmpty({ text }: { text: string }) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={<span className="agri-muted">{text}</span>}
      style={{ margin: "12px 0" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Tổng quan
// ---------------------------------------------------------------------------

export function OrderOverviewTab({ order }: { order: Order }) {
  const address = order.shippingAddressSnapshot;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={14}>
        <DetailCard title="Khách hàng & giao nhận">
          <InfoDescriptions
            column={{ xs: 1, sm: 2, md: 2 }}
            items={[
              {
                key: "customer",
                label: "Khách hàng",
                children: order.customer?.fullName ?? "—",
              },
              { key: "email", label: "Email", children: order.customer?.email ?? "—" },
              {
                key: "phone",
                label: "Số điện thoại",
                children: order.customer?.phone ?? "—",
              },
              {
                key: "createdAt",
                label: "Thời gian đặt",
                children: formatDateTime(order.createdAt),
              },
              {
                key: "recipient",
                label: "Người nhận",
                children: address?.recipientName ?? "—",
              },
              {
                key: "recipientPhone",
                label: "SĐT người nhận",
                children: address?.phone ?? "—",
              },
              {
                key: "address",
                label: "Địa chỉ giao",
                span: 2,
                children: address ? formatAddress(address) : "—",
              },
              {
                key: "note",
                label: "Ghi chú giao hàng",
                span: 2,
                children: order.note ?? "—",
              },
            ]}
          />
        </DetailCard>
      </Col>
      <Col xs={24} lg={10}>
        <DetailCard title="Giá trị đơn hàng">
          <InfoDescriptions
            column={1}
            items={[
              { key: "subtotal", label: "Tạm tính", children: formatMoney(order.subtotal) },
              {
                key: "discount",
                label: "Giảm giá",
                children: formatMoney(order.discountTotal),
              },
              {
                key: "shipping",
                label: "Phí giao hàng",
                children: formatMoney(order.shippingFee),
              },
              {
                key: "grandTotal",
                label: "Tổng thanh toán",
                children: <strong>{formatMoney(order.grandTotal)}</strong>,
              },
            ]}
          />
        </DetailCard>
        <div style={{ height: 16 }} />
        <DetailCard title="Voucher đã dùng">
          {order.voucherRedemptions && order.voucherRedemptions.length > 0 ? (
            <Row gutter={[12, 12]}>
              {order.voucherRedemptions.map((v) => (
                <Col key={v.id} xs={24} sm={12}>
                  <div className="agri-muted" style={{ fontSize: 12 }}>
                    Voucher #{v.voucherId}
                  </div>
                  <div style={{ fontWeight: 600 }}>−{formatMoney(v.discountAmount)}</div>
                </Col>
              ))}
            </Row>
          ) : (
            <SectionEmpty text="Đơn hàng không dùng voucher." />
          )}
        </DetailCard>
      </Col>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Sản phẩm & đối tác
// ---------------------------------------------------------------------------

function PartnerItemsCard({ partnerOrder }: { partnerOrder: PartnerOrder }) {
  const items = partnerOrder.items ?? [];
  return (
    <DetailCard
      title={
        <span>
          Đối tác: {partnerOrder.partner?.name ?? partnerOrder.code}{" "}
          <span className="agri-mono agri-muted" style={{ fontSize: 12, fontWeight: 400 }}>
            {partnerOrder.code}
          </span>
        </span>
      }
      extra={<StatusTag status={orderStatus(partnerOrder.status)} />}
    >
      <InfoDescriptions
        column={{ xs: 1, sm: 2, md: 3 }}
        items={[
          { key: "subtotal", label: "Tạm tính", children: formatMoney(partnerOrder.subtotal) },
          {
            key: "discount",
            label: "Giảm giá",
            children: formatMoney(partnerOrder.discountTotal),
          },
          {
            key: "items",
            label: "Số dòng hàng",
            children: `${items.length}`,
          },
        ]}
      />
      <div style={{ height: 12 }} />
      <Table<OrderItem>
        size="small"
        rowKey="id"
        columns={itemColumns}
        dataSource={items}
        pagination={false}
        scroll={{ x: 640 }}
        locale={{ emptyText: <SectionEmpty text="Đối tác chưa có dòng hàng." /> }}
      />
    </DetailCard>
  );
}

export function OrderItemsTab({ order }: { order: Order }) {
  const partnerOrders = order.partnerOrders ?? [];
  if (partnerOrders.length === 0) {
    return <DetailCard title="Sản phẩm & đối tác"><SectionEmpty text="Đơn hàng chưa có sản phẩm." /></DetailCard>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {partnerOrders.map((po) => (
        <PartnerItemsCard key={po.id} partnerOrder={po} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thanh toán
// ---------------------------------------------------------------------------

export interface PaymentSummary {
  methodLabel: string;
  collected: number;
  refunded: number;
  outstanding: number;
}

/** Explicit, labelled sums over the stored payment/refund rows. */
export function summarizePayments(order: Order): PaymentSummary {
  const payments = order.payments ?? [];
  const collected = payments
    .filter((p) => p.status !== "PENDING" && p.status !== "FAILED")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const refunded = payments
    .flatMap((p) => p.refunds ?? [])
    .filter((r) => r.status === "COMPLETED")
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const total = Number(order.grandTotal);
  const methods = [...new Set(payments.map((p) => paymentMethod(p.method).label))];
  return {
    methodLabel: methods.length > 0 ? methods.join(", ") : "—",
    collected: Number.isFinite(collected) ? collected : 0,
    refunded: Number.isFinite(refunded) ? refunded : 0,
    outstanding: Number.isFinite(total) ? Math.max(0, total - collected) : 0,
  };
}

export function OrderPaymentTab({
  order,
  onCollect,
  collecting,
}: {
  order: Order;
  onCollect: (payment: Payment) => void;
  collecting: boolean;
}) {
  const summary = summarizePayments(order);
  const payments = order.payments ?? [];
  const codUnpaid = payments.some((p) => p.method === "COD" && p.status !== "PAID");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <DetailCard title="Tổng hợp thanh toán">
        <Row gutter={[16, 16]}>
          <Col xs={12} md={8} lg={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Phương thức</div>
            <div style={{ fontWeight: 600 }}>{summary.methodLabel}</div>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Tổng phải thu</div>
            <div style={{ fontWeight: 600 }}>{formatMoney(order.grandTotal)}</div>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Đã thu</div>
            <div style={{ fontWeight: 600 }}>{formatMoney(summary.collected)}</div>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Còn phải thu</div>
            <div style={{ fontWeight: 600 }}>{formatMoney(summary.outstanding)}</div>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Đã hoàn tiền</div>
            <div style={{ fontWeight: 600 }}>{formatMoney(summary.refunded)}</div>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Trạng thái</div>
            <div>
              {payments.length > 0 ? (
                <StatusTag status={paymentStatus(payments[0].status)} />
              ) : (
                "—"
              )}
            </div>
          </Col>
        </Row>
        {codUnpaid && order.status === "DELIVERED" ? (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            message="Đơn đã giao nhưng tiền COD chưa được ghi nhận thu"
            description="Ảnh giao hàng không thay thế bằng chứng đã thu tiền. Kiểm tra biên lai thu tiền của đơn vị vận chuyển rồi ghi nhận ở bảng bên dưới."
          />
        ) : null}
        {codUnpaid && order.status !== "DELIVERED" ? (
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            message="COD chỉ được ghi nhận thu sau khi đơn ở trạng thái Đã giao."
          />
        ) : null}
      </DetailCard>

      <DetailCard title="Lịch sử thanh toán">
        <Table<Payment>
          size="small"
          rowKey="id"
          scroll={{ x: 820 }}
          dataSource={payments}
          pagination={false}
          locale={{ emptyText: <SectionEmpty text="Chưa có bản ghi thanh toán." /> }}
          columns={[
            {
              title: "Mã",
              dataIndex: "id",
              width: 70,
              render: (v: number) => <span className="agri-mono">#{v}</span>,
            },
            {
              title: "Phương thức",
              dataIndex: "method",
              width: 160,
              render: (m: string) => <StatusTag status={paymentMethod(m)} />,
            },
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
              width: 150,
              render: (s: string) => <StatusTag status={paymentStatus(s)} />,
            },
            {
              title: "Mã giao dịch",
              dataIndex: "transactionReference",
              width: 180,
              render: (v: string | null) => (v ? <span className="agri-mono">{v}</span> : "—"),
            },
            {
              title: "Thu tiền lúc",
              dataIndex: "paidAt",
              width: 150,
              render: (v: string | null) => formatDateTime(v),
            },
            {
              title: "Thao tác",
              key: "actions",
              width: 170,
              render: (_v, row) => {
                const canRefund = row.status === "PAID" || row.status === "PARTIALLY_REFUNDED";
                const refundLink = canRefund ? (
                  <Link href={`/refunds?paymentId=${row.id}`} className="agri-link agri-nowrap">
                    Hoàn tiền
                  </Link>
                ) : null;
                if (row.method !== "COD" || row.status !== "PENDING") {
                  return refundLink ?? "—";
                }
                if (order.status !== "DELIVERED") {
                  return <span className="agri-muted">Chờ giao hàng</span>;
                }
                return (
                  <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                    <a
                      className="agri-link agri-nowrap"
                      aria-disabled={collecting}
                      onClick={() => {
                        if (!collecting) onCollect(row);
                      }}
                    >
                      Ghi nhận thu tiền
                    </a>
                    {refundLink}
                  </span>
                );
              },
            },
          ]}
        />
      </DetailCard>

      <DetailCard title="Hoàn tiền">
        {payments.some((p) => (p.refunds ?? []).length > 0) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {payments.map((p) =>
              (p.refunds ?? []).map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    border: "1px solid rgba(0,0,0,0.06)",
                    borderRadius: 8,
                  }}
                >
                  <span className="agri-mono">#{r.id}</span>
                  <strong>{formatMoney(r.amount)}</strong>
                  <StatusTag status={refundStatus(r.status)} />
                  <span className="agri-muted" style={{ fontSize: 12 }}>
                    {r.reason}
                  </span>
                  {r.reference ? (
                    <span className="agri-mono agri-muted" style={{ fontSize: 12 }}>
                      {r.reference}
                    </span>
                  ) : null}
                  <span className="agri-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
                    {formatDateTime(r.completedAt ?? r.approvedAt ?? r.createdAt)}
                  </span>
                </div>
              )),
            )}
          </div>
        ) : (
          <SectionEmpty text="Chưa có yêu cầu hoàn tiền." />
        )}
      </DetailCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vận chuyển
// ---------------------------------------------------------------------------

function ShipmentBlock({ shipment }: { shipment: Shipment }) {
  const events = shipment.events ?? [];
  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <Row gutter={[12, 12]} align="middle">
        <Col xs={24} md={6}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Mã vận đơn</div>
          <div className="agri-mono">{shipment.code}</div>
        </Col>
        <Col xs={12} md={5}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Đơn vị vận chuyển</div>
          <div>{shipment.carrier ?? "—"}</div>
        </Col>
        <Col xs={12} md={5}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Mã tracking</div>
          <div className="agri-mono">{shipment.trackingCode ?? "—"}</div>
        </Col>
        <Col xs={12} md={4}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Trạng thái</div>
          <StatusTag status={shipmentStatus(shipment.status)} />
        </Col>
        <Col xs={12} md={4}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Giao lúc</div>
          <div>{formatDateTime(shipment.deliveredAt ?? shipment.shippedAt)}</div>
        </Col>
      </Row>

      {shipment.failureReason ? (
        <Alert
          style={{ marginTop: 12 }}
          type="error"
          showIcon
          message="Giao hàng thất bại"
          description={shipment.failureReason}
        />
      ) : null}

      <div style={{ marginTop: 12 }}>
        {events.length > 0 ? (
          <Timeline
            items={events.map((e) => ({
              color:
                e.status === "DELIVERY_FAILED"
                  ? "red"
                  : e.status === "DELIVERED"
                    ? "green"
                    : "blue",
              children: (
                <div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <StatusTag status={shipmentStatus(e.status)} />
                    <span className="agri-muted" style={{ fontSize: 12 }}>
                      {formatDateTime(e.occurredAt)}
                    </span>
                  </div>
                  {e.note ? <div style={{ fontSize: 13 }}>{e.note}</div> : null}
                </div>
              ),
            }))}
          />
        ) : (
          <Typography.Text type="secondary">
            Chưa có sự kiện bàn giao nào được ghi nhận.
          </Typography.Text>
        )}
      </div>
    </div>
  );
}

export function OrderShippingTab({ order }: { order: Order }) {
  const partnerOrders = order.partnerOrders ?? [];
  if (partnerOrders.length === 0) {
    return (
      <DetailCard title="Vận chuyển">
        <SectionEmpty text="Đơn hàng chưa có đối tác / vận đơn." />
      </DetailCard>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {partnerOrders.map((po) => (
        <DetailCard
          key={po.id}
          title={`Đối tác: ${po.partner?.name ?? po.code}`}
          extra={<StatusTag status={orderStatus(po.status)} />}
        >
          {(po.shipments ?? []).length > 0 ? (
            (po.shipments ?? []).map((s) => <ShipmentBlock key={s.id} shipment={s} />)
          ) : (
            <SectionEmpty text="Chưa tạo vận đơn cho đối tác này." />
          )}

          {(po.fulfillments ?? []).length > 0 ? (
            <>
              <Typography.Text strong>Đóng gói</Typography.Text>
              <Table
                size="small"
                rowKey="id"
                style={{ marginTop: 8 }}
                pagination={false}
                scroll={{ x: 480 }}
                dataSource={po.fulfillments}
                columns={[
                  {
                    title: "Trạng thái",
                    dataIndex: "status",
                    render: (s: string) => <StatusTag status={fulfillmentStatus(s)} />,
                  },
                  {
                    title: "Đóng gói lúc",
                    dataIndex: "packedAt",
                    render: (v: string | null) => formatDateTime(v),
                  },
                  {
                    title: "Ghi chú",
                    dataIndex: "note",
                    render: (v: string | null) => v ?? "—",
                  },
                ]}
              />
            </>
          ) : null}
        </DetailCard>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tài chính nội bộ
// ---------------------------------------------------------------------------

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

/** Small tag used in the header summary. */
export function PaymentBadge({ payment }: { payment?: Payment }) {
  if (!payment) return <Tag>Chưa thanh toán</Tag>;
  return <StatusTag status={paymentStatus(payment.status)} />;
}
