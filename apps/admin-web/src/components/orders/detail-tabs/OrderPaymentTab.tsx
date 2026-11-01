"use client";

/**
 * "Thanh toán": what must be collected, what was collected and what came back.
 *
 * `summarizePayments` sums the STORED payment/refund rows. Only COMPLETED
 * refunds count as money returned; PENDING/APPROVED are decisions.
 */

import Link from "next/link";
import { Alert, Col, Row, Table } from "antd";
import { DetailCard } from "@/components/common/DetailPage";
import { StatusTag } from "@/components/common/StatusTag";
import { formatDateTime, formatMoney } from "@/lib/format";
import { paymentMethod, paymentStatus, refundStatus } from "@/lib/status";
import type { Order, Payment } from "@/types/api";
import { SectionEmpty } from "./shared";

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
