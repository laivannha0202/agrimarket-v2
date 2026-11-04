"use client";

/**
 * "Vận chuyển": how the parcel moves and where it failed.
 *
 * The timeline is the shipment event history as recorded — nothing is inferred
 * from the order status.
 */

import { Alert, Collapse, Col, Row, Steps, Table, Tag, Timeline, Typography } from "antd";
import { DetailCard } from "@/components/common/DetailPage";
import { StatusTag } from "@/components/common/StatusTag";
import { formatDateTime } from "@/lib/format";
import { fulfillmentStatus, orderStatus, shipmentStatus } from "@/lib/status";
import type { Order, Shipment } from "@/types/api";
import { SectionEmpty } from "./shared";
import {
  deliveryEvidenceLabel,
  hasDeliveryMismatch,
  shipmentCounts,
  shipmentProgressStatus,
  shipmentProgressStep,
  undeliveredShipmentCount,
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
      <Row gutter={[12, 12]} align="middle">
        <Col xs={24} sm={12} md={6}>
          <div className="agri-muted" style={{ fontSize: 12 }}>Mã vận đơn</div>
          <div className="agri-mono">{shipment.code}</div>
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
          <div className="agri-muted" style={{ fontSize: 12 }}>Trạng thái</div>
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

      <div style={{ marginTop: 12, fontSize: 13 }}>
        <span className="agri-muted">Cập nhật cuối: </span>
        {lastEvent ? (
          <>
            <StatusTag status={shipmentStatus(lastEvent.status)} />{" "}
            <span className="agri-muted">{formatDateTime(lastEvent.occurredAt)}</span>
            {lastEvent.note ? <div style={{ marginTop: 4 }}>{lastEvent.note}</div> : null}
          </>
        ) : (
          <span className="agri-muted">Chưa có sự kiện bàn giao nào được ghi nhận.</span>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 12 }} className="agri-muted">
        Vị trí: Chưa có dữ liệu vị trí từ đơn vị vận chuyển.
      </div>

      <div style={{ marginTop: 12 }}>
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
        <SectionEmpty text="Đơn hàng chưa có đối tác / vận đơn." />
      </DetailCard>
    );
  }
  const counts = shipmentCounts(order);
  const mismatch = hasDeliveryMismatch(order);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            <div className="agri-muted" style={{ fontSize: 12 }}>Có vấn đề</div>
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
      </DetailCard>

      {mismatch ? (
        <Alert
          type="warning"
          showIcon
          title="Trạng thái đơn và vận đơn chưa khớp."
          description={
            <span>
              Đơn được ghi nhận Đã giao, nhưng còn {undeliveredShipmentCount(order)} vận đơn
              chưa xác nhận giao thành công.{" "}
              <Tag color="warning">Cần đối chiếu</Tag>
            </span>
          }
        />
      ) : null}

      {partnerOrders.map((po) => (
        <DetailCard
          key={po.id}
          title={`Đối tác: ${po.partner?.name ?? po.code}`}
          extra={<StatusTag status={orderStatus(po.status)} />}
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