"use client";

import { Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime } from "@/lib/format";
import { auditActionLabel, entityTypeLabel, ENTITY_TYPE_OPTIONS } from "@/lib/audit-labels";
import type { AuditLog } from "@/types/api";

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="agri-muted">—</span>;
  }
  return (
    <pre
      style={{
        margin: 0,
        maxHeight: 220,
        overflow: "auto",
        fontSize: 12,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * Read-only audit trail. Every money/stock/state mutation writes one row in the
 * same transaction as the change; this screen only reads and never offers an
 * edit or delete action.
 */
export default function AuditLogsPage() {
  const list = useListState();

  const { data, isLoading, isError, refetch } = useListQuery<AuditLog>(
    queryKeys.auditLogs(list.params),
    resources.auditLogs,
    list.params,
  );

  const columns: ColumnsType<AuditLog> = [
    {
      title: "Thời điểm",
      dataIndex: "createdAt",
      width: 150,
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Người thực hiện",
      render: (_, row) =>
        row.actorUser ? (
          <div>
            <div>{row.actorUser.fullName}</div>
            <div className="agri-muted" style={{ fontSize: 12 }}>
              {row.actorUser.email}
            </div>
          </div>
        ) : (
          <span className="agri-muted">Hệ thống</span>
        ),
    },
    {
      title: "Hành động",
      dataIndex: "action",
      render: (v: string) => (
        <Tag color={auditActionLabel(v) === v ? "default" : "green"}>{auditActionLabel(v)}</Tag>
      ),
    },
    {
      title: "Đối tượng",
      render: (_, row) => (
        <span className="agri-nowrap">
          {entityTypeLabel(row.entityType)}{" "}
          <span className="agri-mono">#{row.entityId}</span>
        </span>
      ),
    },
    {
      title: "Lý do",
      dataIndex: "reason",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
  ];

  return (
    <ListPage<AuditLog>
      title="Nhật ký kiểm toán"
      subtitle="Lịch sử chỉ đọc của mọi thay đổi quan trọng (tiền, tồn kho, trạng thái). Không có thao tác sửa hoặc xóa."
      searchValue={list.search}
      onSearchChange={list.setSearch}
      searchPlaceholder="Tìm theo hành động, loại đối tượng hoặc ID..."
      filters={[
        {
          key: "entityType",
          placeholder: "Loại đối tượng",
          value: list.filters.entityType,
          options: ENTITY_TYPE_OPTIONS,
        },
      ]}
      onFilterChange={list.setFilter}
      onReset={list.reset}
      columns={columns}
      data={data?.data ?? []}
      loading={isLoading}
      error={isError ? new Error("Không tải được nhật ký kiểm toán.") : undefined}
      onRetry={() => void refetch()}
      emptyText="Không có bản ghi phù hợp"
      total={data?.meta.total ?? 0}
      page={list.page}
      limit={list.limit}
      onPageChange={list.setPage}
      onLimitChange={list.setLimit}
      scrollX={1080}
      itemLabel="bản ghi"
      expandable={{
        expandedRowRender: (row) => (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <strong>Trước thay đổi</strong>
              <JsonBlock value={row.beforeJson} />
            </div>
            <div>
              <strong>Sau thay đổi</strong>
              <JsonBlock value={row.afterJson} />
            </div>
          </div>
        ),
      }}
    />
  );
}
