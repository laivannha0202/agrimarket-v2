"use client";

/**
 * "Vận chuyển": how the parcel moves and where it failed.
 *
 * The timeline is the shipment event history as recorded — nothing is inferred
 * from the order status.
 */

import { Alert, Col, Row, Table, Timeline, Typography } from "antd";
import { DetailCard } from "@/components/common/DetailPage";
import { StatusTag } from "@/components/common/StatusTag";
import { formatDateTime } from "@/lib/format";
import { fulfillmentStatus, orderStatus, shipmentStatus } from "@/lib/status";
import type { Order, Shipment } from "@/types/api";
import { SectionEmpty } from "./shared";

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
