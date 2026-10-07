"use client";

import { Input, Select, Button, Space, Pagination } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

export interface SelectFilter {
  key: string;
  placeholder: string;
  value?: string;
  options: { label: string; value: string }[];
  width?: number;
  allowClear?: boolean;
}

interface SearchToolbarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: SelectFilter[];
  onFilterChange?: (key: string, value: string | undefined) => void;
  onReset?: () => void;
  extra?: ReactNode;
  showReset?: boolean;
  hideSearch?: boolean;
}

export function SearchToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Tìm kiếm",
  filters,
  onFilterChange,
  onReset,
  extra,
  showReset = true,
  hideSearch = false,
}: SearchToolbarProps) {
  return (
    <div className="agri-toolbar">
      {hideSearch ? null : (
        <Input
          className="agri-toolbar-search"
          allowClear
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onPressEnter={() => onSearchChange(searchValue)}
          placeholder={searchPlaceholder}
          prefix={<SearchOutlined />}
        />
      )}
      {filters?.map((f) => (
        <Select
          key={f.key}
          allowClear={f.allowClear ?? true}
          placeholder={f.placeholder}
          value={f.value || undefined}
          style={{ width: f.width ?? 180 }}
          options={f.options}
          onChange={(v) => onFilterChange?.(f.key, v)}
        />
      ))}
      {showReset && onReset ? (
        <Button onClick={onReset}>Đặt lại</Button>
      ) : null}
      {extra ? <Space style={{ marginInlineStart: "auto" }}>{extra}</Space> : null}
    </div>
  );
}

export function PaginationSummary({
  total,
  page,
  limit,
  itemLabel = "bản ghi",
  pagination,
}: {
  total: number;
  page: number;
  limit: number;
  itemLabel?: string;
  pagination: ReactNode;
}) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="agri-pagination-summary">
      <span>
        Hiển thị {from}–{to} trên {total} {itemLabel}
      </span>
      {pagination}
    </div>
  );
}

export interface ListPaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

/** Standard footer pagination used by every list page. */
export function ListPagination({
  page,
  limit,
  total,
  onPageChange,
  onLimitChange,
}: ListPaginationProps) {
  return (
    <Pagination
      current={page}
      pageSize={limit}
      total={total}
      showSizeChanger
      pageSizeOptions={[10, 20, 50, 100]}
      showTotal={(t) => `${t} bản ghi`}
      onChange={(nextPage, nextLimit) => {
        if (nextLimit !== limit) {
          onLimitChange(nextLimit);
          return;
        }
        onPageChange(nextPage);
      }}
    />
  );
}
