"use client";

import { Alert, Button, Empty, Skeleton, Table, Typography } from "antd";
import type { ReactNode } from "react";

/** Table loading state: skeleton rows so the layout does not jump. */
export function TableLoading({ columns = 6, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div style={{ padding: 16 }}>
      <Skeleton active paragraph={{ rows }} title={false} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {columns > 0 ? "Đang tải dữ liệu..." : null}
      </Typography.Text>
    </div>
  );
}

/** Full-page loading skeleton for detail pages. */
export function PageLoading() {
  return (
    <div className="agri-card" style={{ padding: 24 }}>
      <Skeleton active paragraph={{ rows: 6 }} />
    </div>
  );
}

export function EmptyState({ description }: { description: string }) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={description}
      style={{ padding: "32px 0" }}
    />
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Alert
      type="error"
      showIcon
      message="Không tải được dữ liệu"
      description={message ?? "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại."}
      action={
        onRetry ? (
          <Button size="small" onClick={onRetry}>
            Thử lại
          </Button>
        ) : undefined
      }
    />
  );
}

/** Wraps a table body with empty/error handling in one place. */
export function DataTable<T extends object>({
  columns,
  data,
  loading,
  error,
  onRetry,
  emptyText,
  rowKey = "id",
  scrollX,
}: {
  columns: Parameters<typeof Table<T>>[0]["columns"];
  data: T[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyText: string;
  rowKey?: string | ((record: T) => string | number);
  scrollX?: number;
}) {
  if (error) {
    return <ErrorState onRetry={onRetry} message={error instanceof Error ? error.message : undefined} />;
  }

  return (
    <Table<T>
      columns={columns}
      dataSource={data}
      loading={loading}
      rowKey={rowKey}
      scroll={scrollX ? { x: scrollX } : undefined}
      locale={{ emptyText: <EmptyState description={emptyText} /> }}
      size="middle"
    />
  );
}

export function Card({ children, bodyStyle }: { children: ReactNode; bodyStyle?: React.CSSProperties }) {
  return (
    <div className="agri-card" style={bodyStyle}>
      {children}
    </div>
  );
}
