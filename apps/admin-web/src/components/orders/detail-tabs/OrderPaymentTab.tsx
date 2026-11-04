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
  /** Order value as agreed at checkout (`orders.grand_total`). */
  originalValue: number;
  /**
   * Effective debt. A cancelled order owes nothing, so its obligation is 0 —
   * the original value is kept for the audit trail, not turned into a fake 0.
   */
  obligation: number;
  collected: number;
  refunded: number;
  /** Still to collect against the effective obligation. */
  outstanding: number;
  /** Money received that must go back (overpayment or cancelled order). */
  refundDue: number;
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
  const originalValue = Number(order.grandTotal);
  const safeOriginal = Number.isFinite(originalValue) ? originalValue : 0;
  const safeCollected = Number.isFinite(collected) ? collected : 0;
  const safeRefunded = Number.isFinite(refunded) ? refunded : 0;
  const obligation = order.status === "CANCELLED" ? 0 : safeOriginal;
  const methods = [...new Set(payments.map((p) => paymentMethod(p.method).label))];
  return {
    methodLabel: methods.length > 0 ? methods.join(", ") : "—",
    originalValue: safeOriginal,
    obligation,
    collected: safeCollected,
    refunded: safeRefunded,
    outstanding: Math.max(0, obligation - safeCollected),
    refundDue: Math.max(0, safeCollected - safeRefunded - obligation),
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
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <span className="agri-muted" style={{ fontSize: 12 }}>
            Phương thức: <strong style={{ color: "var(--agri-text)" }}>{summary.methodLabel}</strong>
          </span>
          <span className="agri-muted" style={{ fontSize: 12 }}>
            Trạng thái:{" "}
            {payments.length > 0 ? (
              <StatusTag status={paymentStatus(payments[0].status)} />
            ) : (
              "—"
            )}
          </span>
        </div>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={8} lg={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Giá trị đơn</div>
            <div style={{ fontWeight: 600 }}>{formatMoney(summary.originalValue)}</div>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Công nợ hiệu lực</div>
            <div style={{ fontWeight: 600 }}>{formatMoney(summary.obligation)}</div>
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
            <div className="agri-muted" style={{ fontSize: 12 }}>Cần hoàn trả</div>
            <div
              style={{
                fontWeight: 600,
                color: summary.refundDue > 0 ? "#cf1322" : undefined,
              }}
            >
              {formatMoney(summary.refundDue)}
            </div>
          </Col>
        </Row>
        {order.status === "CANCELLED" ? (
          <Alert
            style={{ marginTop: 16 }}
            type={summary.refundDue > 0 ? "warning" : "info"}
            showIcon
            title={
              summary.refundDue > 0
                ? `Đơn đã hủy còn ${formatMoney(summary.refundDue)} cần hoàn trả`
                : "Đơn đã hủy — công nợ hiệu lực bằng 0"
            }
            description={
              summary.refundDue > 0
                ? "Giá trị đơn gốc vẫn được giữ để đối chiếu. Khoản tiền đã thu vượt công nợ hiệu lực phải được hoàn qua luồng hoàn tiền, không sửa số tiền của đơn."
                : "Giá trị gốc được giữ để tra cứu; đơn không còn nghĩa vụ thu tiền."
            }
          />
        ) : null}
        {order.status !== "CANCELLED" && summary.refundDue > 0 ? (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            title="Đã thu vượt công nợ"
            description={`Số tiền vượt là ${formatMoney(summary.refundDue)}. Kiểm tra giao dịch thu trùng hoặc ghi nhận sai số tiền trước khi hoàn tiền.`}
          />
        ) : null}
        {codUnpaid && order.status === "DELIVERED" ? (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            title="Đơn đã giao nhưng tiền COD chưa được ghi nhận thu"
            description="Ảnh giao hàng không thay thế bằng chứng đã thu tiền. Kiểm tra biên lai thu tiền của đơn vị vận chuyển rồi ghi nhận ở bảng bên dưới."
          />
        ) : null}
        {codUnpaid && order.status !== "DELIVERED" && order.status !== "CANCELLED" ? (
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            title="COD chỉ được ghi nhận thu sau khi đơn ở trạng thái Đã giao."
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
