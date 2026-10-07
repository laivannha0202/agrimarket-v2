"use client";

import Link from "next/link";
import { Alert, Button, Col, Row, Table, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/Kpi";
import { StatusTag } from "@/components/common/StatusTag";
import { PageLoading, ErrorState } from "@/components/common/States";
import { useDashboardData } from "@/hooks/useDashboardData";
import { formatMoney, formatNumber, formatDateTime } from "@/lib/format";
import { orderStatus } from "@/lib/status";
import type { Order } from "@/types/api";

export default function DashboardPage() {
  const data = useDashboardData();

  if (data.isLoading) return <PageLoading />;
  if (data.isError) return <ErrorState onRetry={data.refetchAll} />;

  const { kpi, actionQueue, recentOrders, statusBreakdown } = data;

  return (
    <>
      <PageHeader
        title="Tổng quan"
        subtitle="Tình hình vận hành sàn nông sản AgriMarket"
        extra={
          <Button icon={<ReloadOutlined />} onClick={data.refetchAll}>
            Làm mới
          </Button>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Doanh thu (đơn không hủy)"
            value={formatMoney(kpi.gmv)}
            hint={`${kpi.orderCount} đơn hàng`}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Giá trị đơn trung bình"
            value={formatMoney(kpi.aov)}
            hint="Trên đơn không hủy"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Hoa hồng đối tác"
            value={formatMoney(kpi.commission)}
            hint="Tổng hoa hồng đã ghi nhận"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Đơn chờ xác nhận"
            value={formatNumber(kpi.pendingOrderCount)}
            tone={kpi.pendingOrderCount > 0 ? "warning" : "success"}
            href="/orders"
          />
        </Col>
      </Row>

      <div style={{ height: 16 }} />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Đơn đang giao"
            value={formatNumber(kpi.shippingOrderCount)}
            href="/orders"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Lô chờ kiểm định"
            value={formatNumber(actionQueue.pendingQcLots.length)}
            tone={actionQueue.pendingQcLots.length > 0 ? "warning" : "success"}
            href="/quality-control"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Chứng nhận chờ xác minh"
            value={formatNumber(actionQueue.pendingCerts.length)}
            tone={actionQueue.pendingCerts.length > 0 ? "warning" : "success"}
            href="/certificates"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Khiếu nại đang xử lý"
            value={formatNumber(actionQueue.openComplaints.length)}
            tone={actionQueue.openComplaints.length > 0 ? "warning" : "success"}
            href="/returns-complaints"
          />
        </Col>
      </Row>

      {(actionQueue.expiredSellable.length > 0 || actionQueue.lowStock.length > 0) && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type="warning"
            showIcon
            message="Cần chú ý"
            description={
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {actionQueue.expiredSellable.length > 0 ? (
                  <li>
                    {actionQueue.expiredSellable.length} lô có thể bán nhưng đã hết hạn —{" "}
                    <Link href="/lots" className="agri-link">
                      xem lô
                    </Link>
                  </li>
                ) : null}
                {actionQueue.lowStock.length > 0 ? (
                  <li>
                    {actionQueue.lowStock.length} dòng tồn kho khả dụng ≤ 20 —{" "}
                    <Link href="/inventory" className="agri-link">
                      xem tồn kho
                    </Link>
                  </li>
                ) : null}
              </ul>
            }
          />
        </div>
      )}

      <div style={{ height: 16 }} />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <div className="agri-card" style={{ padding: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              Đơn hàng gần đây
            </Typography.Title>
            <Table<Order>
              size="middle"
              rowKey="id"
              dataSource={recentOrders}
              pagination={false}
              locale={{ emptyText: "Chưa có đơn hàng" }}
              columns={[
                {
                  title: "Mã đơn",
                  dataIndex: "code",
                  render: (code: string, row) => (
                    <Link href={`/orders/${row.id}`} className="agri-link agri-nowrap">
                      {code}
                    </Link>
                  ),
                },
                {
                  title: "Khách hàng",
                  render: (_, row) => row.customer?.fullName ?? "—",
                },
                {
                  title: "Tổng tiền",
                  dataIndex: "grandTotal",
                  align: "right",
                  render: (v: string) => <span className="agri-nowrap">{formatMoney(v)}</span>,
                },
                {
                  title: "Trạng thái",
                  dataIndex: "status",
                  render: (s: string) => <StatusTag status={orderStatus(s)} />,
                },
                {
                  title: "Ngày tạo",
                  dataIndex: "createdAt",
                  render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
                },
              ]}
            />
          </div>
        </Col>
        <Col xs={24} xl={8}>
          <div className="agri-card" style={{ padding: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              Đơn hàng theo trạng thái
            </Typography.Title>
            <Table
              size="small"
              rowKey="status"
              pagination={false}
              dataSource={statusBreakdown}
              columns={[
                {
                  title: "Trạng thái",
                  dataIndex: "status",
                  render: (s: string) => <StatusTag status={orderStatus(s)} />,
                },
                {
                  title: "Số đơn",
                  dataIndex: "count",
                  align: "right",
                  width: 90,
                },
              ]}
            />
          </div>
        </Col>
      </Row>
    </>
  );
}
