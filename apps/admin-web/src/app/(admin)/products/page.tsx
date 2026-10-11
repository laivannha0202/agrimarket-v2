"use client";

import Link from "next/link";
import { App, Button, Dropdown, Image, Space } from "antd";
import { EditOutlined, EyeOutlined, MoreOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { useCategoryOptions, usePartnerOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatMoney } from "@/lib/format";
import { RECORD_STATUS, recordStatus, statusOptions } from "@/lib/status";
import type { Product } from "@/types/api";

export default function ProductsPage() {
  const list = useListState();
  const categories = useCategoryOptions();
  const partners = usePartnerOptions();
  const { modal } = App.useApp();

  const { data, isLoading, isError, refetch } = useListQuery<Product>(
    queryKeys.products(list.params),
    resources.products,
    list.params,
  );

  const setStatus = useAction(
    (vars: { id: number; status: "ACTIVE" | "INACTIVE" }) =>
      resources.updateProduct(vars.id, { status: vars.status }),
    {
      invalidate: [["products"]],
      successMessage: "Đã cập nhật trạng thái sản phẩm.",
    },
  );

  const confirmDeactivate = (row: Product) => {
    modal.confirm({
      title: "Ngừng bán sản phẩm này?",
      content:
        "Sản phẩm sẽ ẩn khỏi gian hàng. Lịch sử đơn hàng, tồn kho và truy xuất nguồn gốc được giữ nguyên.",
      okText: "Ngừng bán",
      okType: "danger",
      cancelText: "Hủy",
      onOk: () => setStatus.mutate({ id: row.id, status: "INACTIVE" }),
    });
  };

  const columns: ColumnsType<Product> = [
    {
      title: "Ảnh",
      width: 72,
      render: (_, row) => {
        const primary =
          row.images?.find((i) => i.isPrimary)?.url ?? row.images?.[0]?.url;
        return primary ? (
          <Image
            src={primary}
            alt={row.name}
            width={48}
            height={48}
            preview={false}
            style={{ objectFit: "cover", borderRadius: 6 }}
            fallback="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48' fill='%23f5f5f5'/%3E%3C/svg%3E"
          />
        ) : (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 6,
              background: "#f5f5f5",
              color: "#bfbfbf",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            Chưa có ảnh
          </div>
        );
      },
    },
    {
      title: "Sản phẩm",
      render: (_, row) => (
        <div>
          <Link href={`/products/${row.id}`} className="agri-link">
            {row.name}
          </Link>
          <div className="agri-muted agri-mono" style={{ fontSize: 12 }}>
            {row.slug}
          </div>
        </div>
      ),
    },
    {
      title: "Nhóm sản phẩm",
      render: (_, row) => row.category?.name ?? "—",
    },
    {
      title: "Đơn vị bán hàng",
      render: (_, row) => row.partner?.name ?? "—",
    },
    {
      title: "Quy cách",
      align: "right",
      width: 90,
      render: (_, row) => row.variants?.length ?? 0,
    },
    {
      title: "Giá từ",
      align: "right",
      render: (_, row) => {
        const prices = (row.variants ?? []).map((v) => Number(v.basePrice));
        if (prices.length === 0) return "—";
        return <span className="agri-nowrap">{formatMoney(Math.min(...prices))}</span>;
      },
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={recordStatus(s)} />,
    },
    {
      title: "Cập nhật",
      dataIndex: "updatedAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Thao tác",
      width: 210,
      fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Link href={`/products/${row.id}`}>
            <Button type="link" size="small" icon={<EditOutlined />} style={{ paddingInline: 0 }}>
              Sửa
            </Button>
          </Link>
          {row.status === "ACTIVE" ? (
            <Button
              type="link"
              size="small"
              danger
              style={{ paddingInline: 0 }}
              onClick={() => confirmDeactivate(row)}
            >
              Ngừng bán
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0 }}
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: row.id, status: "ACTIVE" })}
            >
              Khôi phục
            </Button>
          )}
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "view",
                  icon: <EyeOutlined />,
                  label: <Link href={`/products/${row.id}`}>Xem chi tiết</Link>,
                },
              ],
            }}
          >
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label="Thao tác khác" />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <ListPage<Product>
      title="Sản phẩm"
      searchValue={list.search}
      onSearchChange={list.setSearch}
      searchPlaceholder="Tìm theo tên, đường dẫn, mã hàng..."
      filters={[
        {
          key: "categoryId",
          placeholder: "Nhóm sản phẩm",
          value: list.filters.categoryId,
          options: (categories.data ?? []).map((o) => ({ label: o.label, value: String(o.value) })),
        },
        {
          key: "partnerId",
          placeholder: "Đơn vị bán hàng",
          value: list.filters.partnerId,
          options: (partners.data ?? []).map((o) => ({ label: o.label, value: String(o.value) })),
          width: 220,
        },
        {
          key: "status",
          placeholder: "Trạng thái",
          value: list.filters.status,
          options: statusOptions(RECORD_STATUS),
        },
      ]}
      onFilterChange={list.setFilter}
      onReset={list.reset}
      toolbarExtra={
        <Link href="/products/new">
          <Button type="primary" icon={<PlusOutlined />}>
            Thêm sản phẩm
          </Button>
        </Link>
      }
      columns={columns}
      data={data?.data ?? []}
      loading={isLoading}
      error={isError ? new Error("Không tải được danh sách sản phẩm.") : undefined}
      onRetry={() => void refetch()}
      emptyText="Không có sản phẩm phù hợp"
      total={data?.meta.total ?? 0}
      page={list.page}
      limit={list.limit}
      onPageChange={list.setPage}
      onLimitChange={list.setLimit}
      scrollX={1240}
      itemLabel="sản phẩm"
    />
  );
}
