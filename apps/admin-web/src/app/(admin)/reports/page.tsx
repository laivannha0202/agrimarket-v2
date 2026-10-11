"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Col, DatePicker, Dropdown, Row, Table, Typography } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/Kpi";
import { StatusTag } from "@/components/common/StatusTag";
import { PageLoading, ErrorState } from "@/components/common/States";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { useExportDownload } from "@/hooks/useExportDownload";
import { formatMoney, formatNumber, formatQuantity } from "@/lib/format";
import type { ReportsSummary } from "@/types/api";
import { complaintStatus, orderStatus, returnStatus } from "@/lib/status";

type Range = [Dayjs | null, Dayjs | null] | null;

const STATUS_ORDER = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPING",
  "DELIVERED",
  "CANCELLED",
];

const RETURN_ORDER = ["REQUESTED", "APPROVED", "RETURNING", "RECEIVED", "QC_PENDING", "REFUNDED", "REJECTED"];
const COMPLAINT_ORDER = ["OPEN", "PROCESSING", "RESOLVED", "REJECTED"];

/**
 * Reports.
 *
 * Every figure comes from the backend aggregate `GET /reports/summary` over
 * the selected window — full-set counts and sums, never a capped list.
 * - "Tổng giá trị đơn hàng" is non-cancelled order value, not money received.
 * - "Doanh thu thực nhận" is collected payments minus completed refunds.
 */
export default function ReportsPage() {
  const [range, setRange] = useState<Range>([dayjs().subtract(30, "day"), dayjs()]);

  const from = range?.[0]?.startOf("day").toISOString();
  const to = range?.[1]?.endOf("day").toISOString();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.reportsSummary({ scope: "reports", from, to }),
    queryFn: () => resources.reportsSummary({ from, to }),
  });

  const { downloading, download } = useExportDownload();
  const exportFile = (format: "xlsx" | "pdf") =>
    download(format, () => resources.exportReport({ format, from, to }));

  if (isLoading) return <PageLoading />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const statusBreakdown = STATUS_ORDER.map((status) => ({
    status,
    count: data.orders.byStatus[status] ?? 0,
  }));
  const returnsByStatus = RETURN_ORDER.map((status) => ({
    status,
    count: data.returns.byStatus[status] ?? 0,
  }));
  const complaintsByStatus = COMPLAINT_ORDER.map((status) => ({
    status,
    count: data.complaints.byStatus[status] ?? 0,
  }));

  return (
    <>
      <PageHeader
        title="Báo cáo"
        subtitle={`Số liệu tính trong khoảng: ${dayjs(data.from).format("DD/MM/YYYY")} – ${dayjs(data.to).format("DD/MM/YYYY")}`}
        extra={
          <>
            <DatePicker.RangePicker
              value={range}
              onChange={(v) => setRange(v)}
              format="DD/MM/YYYY"
              allowClear={false}
            />
            <Dropdown
              menu={{
                items: [
                  {
                    key: "xlsx",
                    label: "Excel (.xlsx)",
                    onClick: () => void exportFile("xlsx"),
                  },
                  {
                    key: "pdf",
                    label: "PDF (.pdf)",
                    onClick: () => void exportFile("pdf"),
                  },
                ],
              }}
              placement="bottomRight"
            >
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloading !== null}
              >
                Xuất báo cáo
              </Button>
            </Dropdown>
            <Button icon={<ReloadOutlined />} onClick={() => void refetch()}>
              Làm mới
            </Button>
          </>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Tổng giá trị đơn hàng"
            value={formatMoney(data.orders.totalOrderValue)}
            hint={`${data.orders.activeCount}/${data.orders.count} đơn không hủy`}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Doanh thu thực nhận"
            value={formatMoney(data.revenue.netCollected)}
            hint="Tiền đã thu trừ tiền đã hoàn trong kỳ"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Giá trị hoàn tiền"
            value={formatMoney(data.revenue.refundTotal)}
            hint="Hoàn tất trong kỳ"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard label="Hoa hồng đã ghi nhận" value={formatMoney(data.commissionRecorded)} />
        </Col>
      </Row>

      <div style={{ height: 16 }} />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard label="Giá trị đơn trung bình" value={formatMoney(data.orders.averageOrderValue)} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label="Đơn chờ xử lý"
            value={formatNumber(data.orders.pendingConfirmation)}
            tone={data.orders.pendingConfirmation > 0 ? "warning" : "success"}
            href="/orders"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard label="Đơn đang giao" value={formatNumber(data.orders.shipping)} href="/orders" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            label={`Dòng tồn kho sắp hết (≤ ${data.inventory.lowStockThreshold})`}
            value={formatNumber(data.inventory.lowStockLines)}
            tone={data.inventory.lowStockLines > 0 ? "warning" : "success"}
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
              dataSource={statusBreakdown}
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
            <Table<ReportsSummary["topProducts"][number]>
              size="small"
              rowKey={(row) => `${row.productId}-${row.sku}`}
              pagination={false}
              dataSource={data.topProducts}
              locale={{ emptyText: "Chưa có dữ liệu bán hàng" }}
              columns={[
                {
                  title: "Sản phẩm",
                  dataIndex: "productName",
                  render: (name: string, row) =>
                    row.productId ? (
                      <Link href={`/products/${row.productId}`} className="agri-link">
                        {name}
                      </Link>
                    ) : (
                      name
                    ),
                },
                {
                  title: "SL đã giao",
                  dataIndex: "quantity",
                  align: "right",
                  render: (v: number, row) => (
                    <span className="agri-nowrap">{formatQuantity(v, row.unit)}</span>
                  ),
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
              dataSource={returnsByStatus}
              columns={[
                {
                  title: "Trạng thái",
                  dataIndex: "status",
                  render: (s: string) => <StatusTag status={returnStatus(s)} />,
                },
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
              dataSource={complaintsByStatus}
              columns={[
                {
                  title: "Trạng thái",
                  dataIndex: "status",
                  render: (s: string) => <StatusTag status={complaintStatus(s)} />,
                },
                { title: "Số khiếu nại", dataIndex: "count", align: "right", width: 110 },
              ]}
            />
          </div>
        </Col>
      </Row>
    </>
  );
}
