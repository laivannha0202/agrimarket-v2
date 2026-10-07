"use client";

import Link from "next/link";
import { Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { useListState } from "@/hooks/useListState";
import { useClientList } from "@/hooks/useClientList";
import { useCategoryOptions, usePartnerOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatMoney } from "@/lib/format";
import { RECORD_STATUS, recordStatus, statusOptions } from "@/lib/status";
import type { Product } from "@/types/api";

// The backend only whitelists page/limit/search/status on /products, so
// category and partner filters are applied in the browser (dataset is small).
const productSearchText = (p: Product) =>
  [p.name, p.slug, ...(p.variants ?? []).map((v) => v.sku)].join(" ");

const productFilter = (p: Product, filters: Record<string, string | undefined>) => {
  if (filters.categoryId && String(p.categoryId) !== filters.categoryId) return false;
  if (filters.partnerId && String(p.partnerId) !== filters.partnerId) return false;
  if (filters.status && p.status !== filters.status) return false;
  return true;
};

export default function ProductsPage() {
  const list = useListState();
  const categories = useCategoryOptions();
  const partners = usePartnerOptions();

  const { data, total, isLoading, isError, refetch } = useClientList<Product>({
    queryKey: queryKeys.products({ scope: "admin-list" }),
    fetcher: resources.products,
    state: list,
    searchText: productSearchText,
    filter: productFilter,
  });

  const columns: ColumnsType<Product> = [
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
      title: "Danh mục",
      render: (_, row) => row.category?.name ?? "—",
    },
    {
      title: "Đối tác",
      render: (_, row) => row.partner?.name ?? "—",
    },
    {
      title: "Biến thể",
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
  ];

  return (
    <ListPage<Product>
      title="Sản phẩm"
      subtitle="Danh mục sản phẩm nông sản"
      searchValue={list.search}
      onSearchChange={list.setSearch}
      searchPlaceholder="Tìm theo tên, slug, SKU..."
      filters={[
        {
          key: "categoryId",
          placeholder: "Danh mục",
          value: list.filters.categoryId,
          options: (categories.data ?? []).map((o) => ({ label: o.label, value: String(o.value) })),
        },
        {
          key: "partnerId",
          placeholder: "Đối tác",
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
      data={data}
      loading={isLoading}
      error={isError ? new Error("Không tải được danh sách sản phẩm.") : undefined}
      onRetry={() => void refetch()}
      emptyText="Không có sản phẩm phù hợp"
      total={total}
      page={list.page}
      limit={list.limit}
      onPageChange={list.setPage}
      onLimitChange={list.setLimit}
      scrollX={1040}
      itemLabel="sản phẩm"
    />
  );
}
