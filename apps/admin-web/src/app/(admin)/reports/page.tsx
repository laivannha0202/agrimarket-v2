"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Col, Row, Table, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/Kpi";
import { StatusTag } from "@/components/common/StatusTag";
import { PageLoading, ErrorState } from "@/components/common/States";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatMoney, formatNumber } from "@/lib/format";
import { orderStatus } from "@/lib/status";
import type { Product } from "@/types/api";

/**
 * Reports.
 *
 * The V2 backend exposes no aggregate/report endpoint, and the demo dataset is
 * well under the 100-row list cap, so reports are derived by aggregating the
 * real list endpoints client-side (no fabricated numbers, no SQL in the UI).
 */
export default function ReportsPage() {
  const orders = useQuery({
    queryKey: queryKeys.orders({ scope: "reports" }),
    queryFn: () => resources.orders({ limit: 100 }),
  });
  const products = useQuery({
    queryKey: queryKeys.products({ scope: "reports" }),
    queryFn: () => resources.products({ limit: 100 }),
  });
  const inventory = useQuery({
    queryKey: queryKeys.inventory({ scope: "reports" }),
    queryFn: () => resources.inventory({ limit: 100 }),
  });
  const returns = useQuery({
    queryKey: queryKeys.returns({ scope: "reports" }),
    queryFn: () => resources.returns({ limit: 100 }),
  });
  const complaints = useQuery({
    queryKey: queryKeys.complaints({ scope: "reports" }),
    queryFn: () => resources.complaints({ limit: 100 }),
  });

  const isLoading =
    orders.isLoading ||
    products.isLoading ||
    inventory.isLoading ||
    returns.isLoading ||
    complaints.isLoading;
  const isError =
    orders.isError ||
    products.isError ||
    inventory.isError ||
    returns.isError ||
    complaints.isError;

  const refetchAll = () => {
    void orders.refetch();
    void products.refetch();
    void inventory.refetch();
    void returns.refetch();
    void complaints.refetch();
  };

  const report = useMemo(() => {
    const orderList = orders.data?.data ?? [];
    const productList = products.data?.data ?? [];
    const inventoryList = inventory.data?.data ?? [];
    const returnList = returns.data?.data ?? [];
    const complaintList = complaints.data?.data ?? [];

    const activeOrders = orderList.filter((o) => o.status !== "CANCELLED");
    const grossRevenue = activeOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
    const commission = orderList
      .flatMap((o) => o.partnerOrders ?? [])
      .reduce((sum, po) => sum + Number(po.commissionAmount), 0);
    const aov = activeOrders.length > 0 ? grossRevenue / activeOrders.length : 0;

    const statusBreakdown = [
      "PENDING_CONFIRMATION",
      "CONFIRMED",
      "PREPARING",
      "READY_TO_SHIP",
      "SHIPPING",
      "DELIVERED",
      "CANCELLED",
    ].map((status) => ({
      status,
      count: orderList.filter((o) => o.status === status).length,
    }));

    const topProducts = productList
      .map((p: Product) => {
        const sales = orderList
          .flatMap((o) => o.partnerOrders ?? [])
          .flatMap((po) => po.items ?? [])
          .filter((item) =>
            (p.variants ?? []).some((v) => v.sku === item.skuSnapshot),
          );
        const quantity = sales.reduce((sum, item) => sum + Number(item.quantity), 0);
        const revenue = sales.reduce((sum, item) => sum + Number(item.subtotal), 0);
        return { id: p.id, name: p.name, quantity, revenue };
      })
      .filter((row) => row.quantity > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const lowStock = inventoryList.filter((b) => Number(b.available) <= 20);

    const returnsByStatus = ["REQUESTED", "APPROVED", "RETURNING", "RECEIVED", "QC_PENDING", "REFUNDED", "REJECTED"].map(
      (status) => ({ status, count: returnList.filter((r) => r.status === status).length }),
    );
    const complaintsByStatus = ["OPEN", "PROCESSING", "RESOLVED", "REJECTED"].map((status) => ({
      status,
      count: complaintList.filter((c) => c.status === status).length,
    }));

    return {
      grossRevenue,
      orderCount: orderList.length,
      activeOrderCount: activeOrders.length,
      commission,
      aov,
      productCount: productList.length,
      lowStockCount: lowStock.length,
      statusBreakdown,
      topProducts,
      returnsByStatus,
      complaintsByStatus,
    };
  }, [orders.data, products.data, inventory.data, returns.data, complaints.data]);

  if (isLoading) return <PageLoading />;
  if (isError) return <ErrorState onRetry={refetchAll} />;

  return (
    <>
      <PageHeader
        title="Báo cáo"
        subtitle="Tổng hợp số liệu vận hành (tính từ dữ liệu thật)"
        extra={
          <Button icon={<ReloadOutlined />} onClick={refetchAll}>
            Làm mới
          </Button>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Doanh thu (đơn không hủy)"
            value={formatMoney(report.grossRevenue)}
            hint={`${report.activeOrderCount}/${report.orderCount} đơn`}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard label="Giá trị đơn trung bình" value={formatMoney(report.aov)} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard label="Hoa hồng đối tác" value={formatMoney(report.commission)} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Tồn kho khả dụng thấp (≤ 20)"
            value={formatNumber(report.lowStockCount)}
            tone={report.lowStockCount > 0 ? "warning" : "success"}
            href="/inventory"
          />
        </Col>
      </Row>

      <div style={{ height: 16 }} />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <div className="agri-card" style={{ padding: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              Đơn hàng theo trạng thái
            </Typography.Title>
            <Table
              size="small"
              rowKey="status"
              pagination={false}
              dataSource={report.statusBreakdown}
              columns={[
                {
                  title: "Trạng thái",
                  dataIndex: "status",
                  render: (s: string) => <StatusTag status={orderStatus(s)} />,
                },
                { title: "Số đơn", dataIndex: "count", align: "right", width: 100 },
              ]}
            />
          </div>
        </Col>

        <Col xs={24} xl={12}>
          <div className="agri-card" style={{ padding: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              Sản phẩm bán chạy
            </Typography.Title>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={report.topProducts}
              locale={{ emptyText: "Chưa có dữ liệu bán hàng" }}
              columns={[
                {
                  title: "Sản phẩm",
                  dataIndex: "name",
                  render: (name: string, row) => (
                    <Link href={`/products/${row.id}`} className="agri-link">
                      {name}
                    </Link>
                  ),
                },
                {
                  title: "SL bán",
                  dataIndex: "quantity",
                  align: "right",
                  render: (v: number) => <span className="agri-nowrap">{formatNumber(v)}</span>,
                },
                {
                  title: "Doanh thu",
                  dataIndex: "revenue",
                  align: "right",
                  render: (v: number) => <span className="agri-nowrap">{formatMoney(v)}</span>,
                },
              ]}
            />
          </div>
        </Col>
      </Row>

      <div style={{ height: 16 }} />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <div className="agri-card" style={{ padding: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              Trả hàng theo trạng thái
            </Typography.Title>
            <Table
              size="small"
              rowKey="status"
              pagination={false}
              dataSource={report.returnsByStatus}
              columns={[
                { title: "Trạng thái", dataIndex: "status" },
                { title: "Số yêu cầu", dataIndex: "count", align: "right", width: 110 },
              ]}
            />
          </div>
        </Col>
        <Col xs={24} xl={12}>
          <div className="agri-card" style={{ padding: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              Khiếu nại theo trạng thái
            </Typography.Title>
            <Table
              size="small"
              rowKey="status"
              pagination={false}
              dataSource={report.complaintsByStatus}
              columns={[
                { title: "Trạng thái", dataIndex: "status" },
                { title: "Số khiếu nại", dataIndex: "count", align: "right", width: 110 },
              ]}
            />
          </div>
        </Col>
      </Row>

      <div style={{ marginTop: 16 }}>
        <Alert
          type="info"
          showIcon
          message="Báo cáo tổng hợp từ API"
          description="Số liệu được tổng hợp từ các endpoint danh sách thật (tối đa 100 bản ghi mỗi loại). Backend chưa có endpoint báo cáo tổng hợp riêng."
        />
      </div>
    </>
  );
}
