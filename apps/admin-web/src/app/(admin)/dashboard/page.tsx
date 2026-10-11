"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Alert, Button, Col, Row, Segmented, Table, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/Kpi";
import { StatusTag } from "@/components/common/StatusTag";
import { PageLoading, ErrorState } from "@/components/common/States";
import { useDashboardData } from "@/hooks/useDashboardData";
import { formatMoney, formatNumber, formatDateTime, formatDate } from "@/lib/format";
import { orderStatus } from "@/lib/status";
import type { Order } from "@/types/api";

// Canvas charts must not be server-rendered (they need the DOM).
const RevenueByDayChart = dynamic(
  () => import("@/components/dashboard/DashboardCharts").then((m) => m.RevenueByDayChart),
  { ssr: false },
);
const OrdersByStatusChart = dynamic(
  () => import("@/components/dashboard/DashboardCharts").then((m) => m.OrdersByStatusChart),
  { ssr: false },
);

export default function DashboardPage() {
  const data = useDashboardData();

  if (data.isLoading) return <PageLoading />;
  if (data.isError) return <ErrorState onRetry={data.refetchAll} />;

  const { kpi, actionQueue, recentOrders, statusBreakdown, days, windowFrom, windowTo } = data;

  // The KPI cards below are computed over this window (from the API), never the
  // whole history — state it so a 30-day figure is not read as "all time".
  const periodLabel =
    windowFrom && windowTo
      ? `${formatDate(windowFrom)} – ${formatDate(windowTo)} (${days} ngày)`
      : `(${days} ngày)`;

  const workQueue = [
    { label: "Lô chờ kiểm định", count: actionQueue.pendingQcCount, href: "/quality-control" },
    { label: "Chứng nhận chờ xác minh", count: actionQueue.pendingCertCount, href: "/certificates" },
    { label: "Trả hàng chờ xử lý", count: actionQueue.openReturnCount, href: "/returns-complaints" },
    { label: "Khiếu nại đang xử lý", count: actionQueue.openComplaintCount, href: "/returns-complaints" },
    { label: "Dòng tồn kho sắp hết", count: actionQueue.lowStockLineCount, href: "/inventory" },
  ];

  const statusChartData = statusBreakdown.map((s) => ({
    status: orderStatus(s.status).label,
    count: s.count,
  }));

  return (
    <>
      <PageHeader
        title="Tổng quan"
        subtitle={`Số liệu doanh thu, đơn hàng trong kỳ: ${periodLabel}`}
        extra={
          <Button icon={<ReloadOutlined />} onClick={data.refetchAll}>
            Làm mới
          </Button>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Tổng giá trị đơn hàng"
            value={formatMoney(kpi.totalOrderValue)}
            hint={`${kpi.activeOrderCount}/${kpi.orderCount} đơn không hủy`}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Doanh thu thực nhận"
            value={formatMoney(kpi.netCollected)}
            hint={`Đã thu ${formatMoney(kpi.grossCollected)}`}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Hoa hồng đã ghi nhận"
            value={formatMoney(kpi.commission)}
            hint="Theo đơn không hủy"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Giá trị hoàn tiền"
            value={formatMoney(kpi.refundTotal)}
            hint="Hoàn thành trong kỳ"
          />
        </Col>
      </Row>

      <div style={{ height: 16 }} />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Đơn chờ xử lý"
            value={formatNumber(kpi.pendingOrderCount)}
            tone={kpi.pendingOrderCount > 0 ? "warning" : "success"}
            href="/orders"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Đơn đang giao"
            value={formatNumber(kpi.shippingOrderCount)}
            href="/orders"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Khiếu nại đang xử lý"
            value={formatNumber(actionQueue.openComplaintCount)}
            tone={actionQueue.openComplaintCount > 0 ? "warning" : "success"}
            href="/returns-complaints"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label={`Dòng tồn kho sắp hết (≤ ${actionQueue.lowStockThreshold})`}
            value={formatNumber(actionQueue.lowStockLineCount)}
            tone={actionQueue.lowStockLineCount > 0 ? "warning" : "success"}
            href="/inventory"
          />
        </Col>
      </Row>

      {(actionQueue.expiredCount > 0 || actionQueue.expiringCount > 0) && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type="warning"
            showIcon
            title="Lô hàng sắp hết hạn"
            description={
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {actionQueue.expiredCount > 0 ? (
                  <li>
                    {actionQueue.expiredCount} lô có thể bán nhưng đã hết hạn —{" "}
                    <Link href="/lots" className="agri-link">
                      xem lô
                    </Link>
                  </li>
                ) : null}
                {actionQueue.expiringCount > 0 ? (
                  <li>
                    {actionQueue.expiringCount} lô có thể bán sắp hết hạn trong 7 ngày —{" "}
                    <Link href="/lots" className="agri-link">
                      xem lô
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <Typography.Title level={5} style={{ margin: 0 }}>
                Doanh thu thực nhận theo ngày
              </Typography.Title>
              <Segmented
                value={data.days}
                onChange={(v) => data.setDays(v as 7 | 30)}
                options={[
                  { label: "7 ngày", value: 7 },
                  { label: "30 ngày", value: 30 },
                ]}
              />
            </div>
            <RevenueByDayChart points={data.dailyPoints} />
          </div>
        </Col>
        <Col xs={24} xl={8}>
          <div className="agri-card" style={{ padding: 16, height: "100%" }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              Việc cần xử lý
            </Typography.Title>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {workQueue.map((item) => (
                <li
                  key={item.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom: "1px solid var(--agri-border)",
                  }}
                >
                  <Link href={item.href} className="agri-link">
                    {item.label}
                  </Link>
                  <span style={{ fontWeight: 600, color: item.count > 0 ? "#d48806" : undefined }}>
                    {formatNumber(item.count)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Col>
      </Row>

      <div style={{ height: 16 }} />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
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
        <Col xs={24} xl={10}>
          <div className="agri-card" style={{ padding: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              Đơn hàng theo trạng thái
            </Typography.Title>
            <OrdersByStatusChart data={statusChartData} />
          </div>
        </Col>
      </Row>
    </>
  );
}
