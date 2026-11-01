"use client";

import type { ReactNode } from "react";
import { Table } from "antd";
import type { ColumnsType, TableProps } from "antd/es/table";
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
  /**
   * Process note rendered between the page header and the toolbar. It belongs
   * below the title: a warning above `<h1>` reads as a browser-level banner
   * and pushes the page identity out of the first screen.
   */
  notice?: ReactNode;
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
  expandable?: TableProps<T>["expandable"];
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
  notice,
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
  expandable,
}: ListPageProps<T>) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} extra={headerExtra} />
      {notice ? <div style={{ marginBottom: 16 }}>{notice}</div> : null}
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
              // Without `x`, antd sizes the table to its content and the card
              // cannot clip it: a four-column table on a 390px phone widened
              // the whole document (the page scrolled sideways). `max-content`
              // keeps the overflow inside the card's own scroll container.
              scroll={{ x: scrollX ?? "max-content" }}
              pagination={false}
              locale={{ emptyText }}
              expandable={expandable}
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
