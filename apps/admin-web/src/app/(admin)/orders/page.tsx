"use client";

import Link from "next/link";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatMoney, formatDateTime } from "@/lib/format";
import { ORDER_STATUS, orderStatus, statusOptions } from "@/lib/status";
import type { Order } from "@/types/api";

export default function OrdersPage() {
  const list = useListState();
  const { data, isLoading, isError, refetch } = useListQuery<Order>(
    queryKeys.orders(list.params),
    resources.orders,
    list.params,
  );

  const columns: ColumnsType<Order> = [
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
      render: (_, row) => (
        <div>
          <div>{row.customer?.fullName ?? "—"}</div>
          <div className="agri-muted" style={{ fontSize: 12 }}>
            {row.customer?.email ?? ""}
          </div>
        </div>
      ),
    },
    {
      title: "Số đối tác",
      align: "right",
      width: 110,
      render: (_, row) => row.partnerOrders?.length ?? 0,
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
  ];

  return (
    <ListPage<Order>
      title="Đơn hàng"
      subtitle="Quản lý đơn hàng và tiến trình giao nhận"
      searchValue={list.search}
      onSearchChange={list.setSearch}
      searchPlaceholder="Tìm theo mã đơn, tên khách hàng..."
      filters={[
        {
          key: "status",
          placeholder: "Trạng thái",
          value: list.filters.status,
          options: statusOptions(ORDER_STATUS),
        },
      ]}
      onFilterChange={list.setFilter}
      onReset={list.reset}
      columns={columns}
      data={data?.data ?? []}
      loading={isLoading}
      error={isError ? new Error("Không tải được danh sách đơn hàng.") : undefined}
      onRetry={() => void refetch()}
      emptyText="Không có đơn hàng phù hợp"
      total={data?.meta.total ?? 0}
      page={list.page}
      limit={list.limit}
      onPageChange={list.setPage}
      onLimitChange={list.setLimit}
      scrollX={900}
      itemLabel="đơn hàng"
    />
  );
}
