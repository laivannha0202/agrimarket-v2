"use client";

/**
 * "Vận chuyển": how the parcel moves and where it failed.
 *
 * The timeline is the shipment event history as recorded — nothing is inferred
 * from the order status.
 */

import { Alert, Collapse, Col, Row, Steps, Table, Tag, Timeline, Typography } from "antd";
import Link from "next/link";
import { DetailCard } from "@/components/common/DetailPage";
import { StatusTag } from "@/components/common/StatusTag";
import { formatDateTime } from "@/lib/format";
import { fulfillmentStatus, orderStatus, shipmentStatus } from "@/lib/status";
import type { Order, Shipment } from "@/types/api";
import { SectionEmpty } from "./shared";
import {
  deliveryEvidenceLabel,
  hasDeliveryMismatch,
  hasPartnerDeliveryMismatch,
  mismatchedPartnerOrders,
  partnerShipmentStatusSummary,
  shipmentCounts,
  shipmentProgressStatus,
  shipmentProgressStep,
} from "@/lib/orderShipping";

function ShipmentCard({ shipment }: { shipment: Shipment }) {
  const events = [...(shipment.events ?? [])].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const lastEvent = events[0];

  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 8,
        padding: 12,
      }}
    >
      <Row gutter={[8, 8]} align="middle">
        <Col xs={24} sm={12} md={6}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Mã vận đơn</div>
          <div className="agri-mono" style={{ wordBreak: "break-all" }}>{shipment.code}</div>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Đơn vị vận chuyển</div>
          <div>{shipment.carrier ?? "—"}</div>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Mã tracking</div>
          <div className="agri-mono" style={{ wordBreak: "break-all" }}>
            {shipment.trackingCode ?? "—"}
          </div>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Vận đơn</div>
          <StatusTag status={shipmentStatus(shipment.status)} />
        </Col>
        <Col xs={12} sm={6} md={6}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Giao lúc</div>
          <div>{deliveryEvidenceLabel(shipment)}</div>
        </Col>
      </Row>

      {shipment.failureReason ? (
        <Alert
          style={{ marginTop: 12 }}
          type="error"
          showIcon
          title="Giao hàng thất bại"
          description={shipment.failureReason}
        />
      ) : null}

      <div style={{ marginTop: 12 }}>
        <Steps
          size="small"
          current={shipmentProgressStep(shipment.status)}
          status={shipmentProgressStatus(shipment.status)}
          items={[
            { title: "Đã tạo" },
            { title: "Đang vận chuyển" },
            { title: "Giao thành công" },
          ]}
        />
      </div>

      <div style={{ marginTop: 8, fontSize: 13 }} className="agri-muted">
        Cập nhật cuối:{" "}
        {lastEvent ? (
          <>
            <StatusTag status={shipmentStatus(lastEvent.status)} />{" "}
            <span>{formatDateTime(lastEvent.occurredAt)}</span>
            {lastEvent.note ? <span> — {lastEvent.note}</span> : null}
          </>
        ) : (
          <span>Chưa có sự kiện bàn giao nào được ghi nhận.</span>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <Collapse
          items={[
            {
              key: `history-${shipment.id}`,
              label: "Xem lịch sử",
              children:
                events.length > 0 ? (
                  <Timeline
                    items={events.map((e) => ({
                      color:
                        e.status === "DELIVERY_FAILED"
                          ? "red"
                          : e.status === "DELIVERED"
                            ? "green"
                            : "blue",
                      content: (
                        <div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <StatusTag status={shipmentStatus(e.status)} />
                            <span className="agri-muted" style={{ fontSize: 12 }}>
                              {formatDateTime(e.occurredAt)}
                            </span>
                          </div>
                          {e.note ? <div style={{ fontSize: 13, marginTop: 2 }}>{e.note}</div> : null}
                        </div>
                      ),
                    }))}
                  />
                ) : (
                  <Typography.Text type="secondary">
                    Chưa có sự kiện bàn giao nào được ghi nhận.
                  </Typography.Text>
                ),
            },
          ]}
        />
      </div>
    </div>
  );
}

export function OrderShippingTab({ order }: { order: Order }) {
  const partnerOrders = order.partnerOrders ?? [];
  if (partnerOrders.length === 0) {
    return (
      <DetailCard title="Vận chuyển">
        {order.status === "DELIVERED" ? (
          <Alert type="warning" showIcon title="Trạng thái đơn và vận đơn chưa khớp." description="Đơn đã giao nhưng chưa có đơn đối tác để xác nhận bằng chứng giao hàng." style={{ marginBottom: 12 }} />
        ) : null}
        <SectionEmpty text="Đơn hàng chưa có đối tác / vận đơn." />
      </DetailCard>
    );
  }
  const counts = shipmentCounts(order);
  const mismatch = hasDeliveryMismatch(order);
  const mismatched = mismatchedPartnerOrders(order);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/*
       * Provenance of the DELIVERED status: only shipment evidence may flip an
       * order to delivered, so the tab states that rule in place. Restored
       * after `fb4dfa5` dropped it while `e2e/admin/final-uat.spec.ts` still
       * asserts it (UAT-03/05).
       */}
      <Alert
        type="info"
        showIcon
        title="Giao hàng được ghi nhận từ vận đơn"
        description={
          <span>
            Trạng thái “Đã giao” của đơn là kết quả tổng hợp từ vận đơn, không phải
            thao tác trực tiếp trên đơn. Tạo và cập nhật vận đơn tại{" "}
            <Link href="/shipments" className="agri-link">
              trang Vận đơn
            </Link>
            ; hệ thống chỉ chuyển đơn sang Đã giao khi mọi đơn đối tác có vận đơn giao
            thành công và không còn vận đơn đang xử lý.
          </span>
        }
      />
      <DetailCard title="Tổng quan vận chuyển">
        <Row gutter={[12, 12]}>
          <Col xs={12} sm={8} md={6}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Trạng thái đơn</div>
            <div style={{ fontWeight: 600, marginTop: 4 }}>
              <StatusTag status={orderStatus(order.status)} />
            </div>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Số vận đơn</div>
            <div style={{ fontWeight: 600 }}>{counts.total}</div>
          </Col>
          <Col xs={12} sm={8} md={5}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Đã giao thành công</div>
            <div style={{ fontWeight: 600, color: "#16834A" }}>{counts.delivered}</div>
          </Col>
          <Col xs={12} sm={8} md={5}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Đang xử lý</div>
            <div style={{ fontWeight: 600, color: "#1769bc" }}>{counts.inProgress}</div>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <div className="agri-muted" style={{ fontSize: 12 }}>Vận đơn gặp lỗi</div>
            <div style={{ fontWeight: 600, color: counts.problems > 0 ? "#cf1322" : undefined }}>
              {counts.problems}
            </div>
          </Col>
        </Row>
        {counts.missingDeliveryTime > 0 ? (
          <div style={{ marginTop: 8, fontSize: 12 }} className="agri-muted">
            {counts.missingDeliveryTime} vận đơn ghi nhận Đã giao nhưng thiếu thời điểm giao.
          </div>
        ) : null}
        {mismatched.length > 0 ? (
          <div style={{ marginTop: 8, fontSize: 12 }} className="agri-muted">
            Bất nhất dữ liệu: {mismatched.length} đơn đối tác thiếu bằng chứng giao hàng hợp lệ
            {" "}({mismatched.map((m) => m.name).join(", ")}).
          </div>
        ) : null}
      </DetailCard>

      {mismatch ? (
        <Alert
          type="warning"
          showIcon
          title="Trạng thái đơn và vận đơn chưa khớp."
          description={
            <span>
              Trạng thái đã giao thiếu bằng chứng hợp lệ hoặc còn vận đơn đang xử lý.{" "}
              <Tag color="warning">Cần đối chiếu</Tag>
            </span>
          }
        />
      ) : null}

      {partnerOrders.map((po) => (
        <DetailCard
          key={po.id}
          title={`Đối tác: ${po.partner?.name ?? po.code}`}
          extra={
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
              <span className="agri-muted">Đơn đối tác:</span>
              <StatusTag status={orderStatus(po.status)} />
              <span className="agri-muted">Vận đơn:</span>
              {(() => { const ss = (po.shipments ?? []); const uniq = new Set(ss.map((x: { status: string }) => x.status)); if (ss.length && uniq.size === 1) return <StatusTag status={shipmentStatus(ss[0].status)} />; return <span>{partnerShipmentStatusSummary(po)}</span>; })()}
              {hasPartnerDeliveryMismatch(po) ? (
                <Tag color="warning">Cần đối chiếu</Tag>
              ) : null}
            </div>
          }
        >
          {(po.shipments ?? []).length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(po.shipments ?? []).map((s) => (
                <ShipmentCard key={s.id} shipment={s} />
              ))}
            </div>
          ) : (
            <SectionEmpty text="Chưa tạo vận đơn cho đối tác này." />
          )}

          {(po.fulfillments ?? []).length > 0 ? (
            <div style={{ marginTop: 12 }}>
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
            </div>
          ) : null}
        </DetailCard>
      ))}
    </div>
  );
}
