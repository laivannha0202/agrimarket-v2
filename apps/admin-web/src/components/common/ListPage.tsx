"use client";

import type { ReactNode } from "react";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PageHeader } from "@/components/common/PageHeader";
import { SearchToolbar, ListPagination, type SelectFilter } from "@/components/common/Toolbar";
import { ErrorState } from "@/components/common/States";

interface ListPageProps<T> {
  title: string;
  subtitle?: ReactNode;
  headerExtra?: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: SelectFilter[];
  onFilterChange?: (key: string, value: string | undefined) => void;
  onReset?: () => void;
  toolbarExtra?: ReactNode;
  hideSearch?: boolean;
  columns: ColumnsType<T>;
  data: T[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyText: string;
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  scrollX?: number;
  itemLabel?: string;
}

/**
 * Standard list page layout shared by every admin list view: header, search +
 * filters toolbar, data table and footer pagination.
 */
export function ListPage<T extends object>({
  title,
  subtitle,
  headerExtra,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filters,
  onFilterChange,
  onReset,
  toolbarExtra,
  hideSearch,
  columns,
  data,
  loading,
  error,
  onRetry,
  emptyText,
  total,
  page,
  limit,
  onPageChange,
  onLimitChange,
  scrollX,
  itemLabel = "bản ghi",
}: ListPageProps<T>) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} extra={headerExtra} />
      <SearchToolbar
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        filters={filters}
        onFilterChange={onFilterChange}
        onReset={onReset}
        extra={toolbarExtra}
        hideSearch={hideSearch}
      />
      {error ? (
        <ErrorState onRetry={onRetry} message={error instanceof Error ? error.message : undefined} />
      ) : (
        <>
          <div className="agri-card">
            <Table<T>
              columns={columns}
              dataSource={data}
              loading={loading}
              rowKey="id"
              scroll={scrollX ? { x: scrollX } : undefined}
              pagination={false}
              locale={{ emptyText }}
            />
          </div>
          <div className="agri-pagination-summary">
            <span>
              Hiển thị {total === 0 ? 0 : (page - 1) * limit + 1}–
              {Math.min(page * limit, total)} trên {total} {itemLabel}
            </span>
            <ListPagination
              page={page}
              limit={limit}
              total={total}
              onPageChange={onPageChange}
              onLimitChange={onLimitChange}
            />
          </div>
        </>
      )}
    </>
  );
}
