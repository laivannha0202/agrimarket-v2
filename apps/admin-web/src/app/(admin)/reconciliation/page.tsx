"use client";

/**
 * Admin — Đối chiếu dòng tiền (read-only).
 *
 * Every number on this screen comes from `GET /finance/reconciliation`: the
 * API compares each order's obligation with the payments it actually collected
 * and the refunds it actually returned. The page displays those values; it does
 * not add money up itself, because a second implementation of the collection
 * rule is a second answer to "how much did we receive".
 *
 * The screen is deliberately a worklist, not a repair tool: there is no button
 * that edits a payment, a refund or a settlement. A discrepancy is corrected
 * through the normal collection/refund flow so the audit trail explains the new
 * balance — and that flow needs a human decision, not a client-side patch.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Alert,
  Checkbox,
  Col,
  DatePicker,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { ListPage } from "@/components/common/ListPage";
import { KpiCard } from "@/components/common/Kpi";
import { StatusTag } from "@/components/common/StatusTag";
import { useListState } from "@/hooks/useListState";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import {
  COLLECTION_STATE,
  ORDER_STATUS,
  RECONCILIATION_ISSUE,
  RECONCILIATION_REFUND_STATE,
  collectionState,
  orderStatus,
  reconciliationIssue,
  reconciliationRefundState,
  settlementStatus,
  statusOptions,
} from "@/lib/status";
import type {
  ReconciliationFinding,
  ReconciliationIssue,
  ReconciliationReport,
} from "@/types/api";

const { RangePicker } = DatePicker;

/**
 * What each finding means, in the operator's words. Kept next to the table
 * because the label alone ("Thu thiếu") does not say what to look at.
 */
const ISSUE_REASON: Record<ReconciliationIssue, string> = {
  UNDER_COLLECTED:
    "Số tiền đã thu nhỏ hơn tổng phải thu. Kiểm tra lần thu còn thiếu hoặc lần thu COD chưa được ghi nhận.",
  OVER_COLLECTED:
    "Số tiền đã thu lớn hơn tổng phải thu. Có thể thu trùng hoặc ghi nhận sai số tiền.",
  SETTLED_WITHOUT_FULL_COLLECTION:
    "Đơn đã có dòng quyết toán nhưng chưa thu đủ tiền. Rà soát kỳ quyết toán tương ứng trước khi chi trả.",
  REFUND_WITHOUT_COLLECTION:
    "Có khoản hoàn tiền đã hoàn tất nhưng đơn chưa từng ghi nhận thu tiền.",
  REFUND_STATUS_MISMATCH:
    "Trạng thái hoàn tiền của payment không khớp tổng refund đã hoàn tất.",
  MISSING_COLLECTION_EVIDENCE:
    "Payment ở trạng thái đã thu nhưng thiếu thời điểm thu (paid_at), nên số tiền không được tính vào đã thu.",
};

/** ISO strings for the API, from the picker's day boundaries. */
function rangeToFilters(value: [Dayjs | null, Dayjs | null] | null) {
  if (!value || !value[0] || !value[1]) return { from: undefined, to: undefined };
  return {
    from: value[0].startOf("day").toISOString(),
    to: value[1].endOf("day").toISOString(),
  };
}

function ReconciliationDetail({ row }: { row: ReconciliationFinding }) {
  return (
    <div style={{ maxWidth: 980 }}>
      <Typography.Text strong>Nguyên nhân</Typography.Text>
      <ul style={{ margin: "8px 0 16px", paddingInlineStart: 20 }}>
        {row.issues.length === 0 ? (
          <li>
            Không có chênh lệch. Đơn được liệt kê vì bộ lọc hiện tại cho phép hiện cả
            đơn không có vấn đề.
          </li>
        ) : (
          row.issues.map((issue) => (
            <li key={issue}>
              <StatusTag status={reconciliationIssue(issue)} /> {ISSUE_REASON[issue]}
            </li>
          ))
        )}
      </ul>

      <Typography.Text strong>Số liệu do hệ thống ghi nhận</Typography.Text>
      <div style={{ margin: "8px 0 16px", color: "var(--agri-text-secondary)" }}>
        <StatusTag status={orderStatus(row.status)} /> Giá trị đơn{" "}
        {formatMoney(row.originalValue)} · Công nợ hiệu lực {formatMoney(row.obligation)} · Đã thu{" "}
        {formatMoney(row.collected)} · Đã hoàn {formatMoney(row.refunded)} · Còn thiếu{" "}
        {formatMoney(row.outstanding)} · Cần hoàn trả {formatMoney(row.refundDue)}
      </div>

      <Typography.Text strong>Payment</Typography.Text>
      <div style={{ margin: "8px 0 16px" }}>
        {row.paymentStatuses.length === 0 ? (
          <Typography.Text type="secondary">Đơn chưa có bản ghi thanh toán.</Typography.Text>
        ) : (
          <Space wrap size={[8, 8]}>
            {row.paymentStatuses.map((status, index) => (
              <Tag key={`${status}-${index}`}>{status}</Tag>
            ))}
          </Space>
        )}
      </div>

      <Space wrap size={[16, 8]}>
        <Link href={`/orders/${row.orderId}`} className="agri-link">
          Mở chi tiết đơn
        </Link>
        <Link href={`/orders/${row.orderId}?tab=payment`} className="agri-link">
          Mở tab thanh toán
        </Link>
        {row.settlements.map((settlement) => (
          <Link key={settlement.id} href={`/settlements/${settlement.id}`} className="agri-link">
            Kỳ quyết toán {settlement.code}
          </Link>
        ))}
      </Space>
    </div>
  );
}

export default function ReconciliationPage() {
  const list = useListState();
  const { data, isLoading, isError, refetch } = useQuery<ReconciliationReport, Error>({
    queryKey: queryKeys.reconciliation(list.params),
    queryFn: () => resources.reconciliation(list.params),
    placeholderData: keepPreviousData,
  });

  const summary = data?.summary;
  const scanned = data?.scanned ?? 0;
  const withoutFindings = Math.max(0, scanned - (summary?.ordersWithFindings ?? 0));

  const activeIssue = list.filters.issue;
  const activeCollection = list.filters.collection;
  const includeMatched = list.filters.includeMatched === "true";

  /**
   * A collection bucket ("đã thu đủ", "chưa ghi nhận thu") is only useful when
   * orders without a finding are listed too — otherwise the bucket would show
   * only its exceptions. Selecting one therefore widens the list in the same
   * click; the checkbox below the toolbar says so explicitly.
   */
  const pickCollection = (value: string) => {
    const next = activeCollection === value ? undefined : value;
    list.setFilter("collection", next);
    list.setFilter("includeMatched", next ? "true" : undefined);
  };

  const columns: ColumnsType<ReconciliationFinding> = [
    {
      title: "Mã đơn",
      dataIndex: "code",
      render: (code: string, row) => (
        <Link href={`/orders/${row.orderId}`} className="agri-link agri-mono">
          {code}
        </Link>
      ),
    },
    {
      /**
       * Second column on purpose: it is the reason the row is here. At 1440px
       * (and on a phone, where the table scrolls inside its card) the money
       * columns after it are only useful once the problem is known.
       */
      title: "Vấn đề",
      dataIndex: "issues",
      render: (issues: ReconciliationIssue[]) =>
        issues.length === 0 ? (
          <Typography.Text type="secondary">Không có</Typography.Text>
        ) : (
          <Space wrap size={[4, 4]}>
            {issues.map((issue) => (
              <StatusTag key={issue} status={reconciliationIssue(issue)} />
            ))}
          </Space>
        ),
    },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      render: (value: string) => <span className="agri-nowrap">{formatDateTime(value)}</span>,
    },
    {
      title: "Giá trị đơn",
      dataIndex: "originalValue",
      align: "right",
      render: (value: number) => <span className="agri-nowrap">{formatMoney(value)}</span>,
    },
    {
      title: "Công nợ hiệu lực",
      dataIndex: "obligation",
      align: "right",
      render: (value: number) => <span className="agri-nowrap">{formatMoney(value)}</span>,
    },
    {
      title: "Đã thu",
      dataIndex: "collected",
      align: "right",
      render: (value: number) => <span className="agri-nowrap">{formatMoney(value)}</span>,
    },
    {
      title: "Đã hoàn",
      dataIndex: "refunded",
      align: "right",
      render: (value: number) => <span className="agri-nowrap">{formatMoney(value)}</span>,
    },
    {
      title: "Còn thiếu",
      dataIndex: "outstanding",
      align: "right",
      render: (value: number) => (
        <span className="agri-nowrap" style={{ color: value > 0 ? "#cf1322" : undefined }}>
          {formatMoney(value)}
        </span>
      ),
    },
    {
      title: "Cần hoàn trả",
      dataIndex: "refundDue",
      align: "right",
      render: (value: number) => (
        <span className="agri-nowrap" style={{ color: value > 0 ? "#cf1322" : undefined }}>
          {formatMoney(value)}
        </span>
      ),
    },
    {
      title: "Mức thu",
      dataIndex: "collection",
      render: (value: string) => <StatusTag status={collectionState(value)} />,
    },
    {
      title: "Hoàn tiền",
      dataIndex: "refundState",
      render: (value: string) => <StatusTag status={reconciliationRefundState(value)} />,
    },
    {
      title: "Quyết toán",
      dataIndex: "settled",
      render: (_value: boolean, row) =>
        row.settlements.length === 0 ? (
          <Tag>Chưa quyết toán</Tag>
        ) : (
          <Space orientation="vertical" size={4}>
            {row.settlements.map((settlement) => (
              <span key={settlement.id} className="agri-nowrap">
                <Link href={`/settlements/${settlement.id}`} className="agri-link agri-mono">
                  {settlement.code}
                </Link>{" "}
                <StatusTag status={settlementStatus(settlement.status)} />
              </span>
            ))}
          </Space>
        ),
    },
  ];

  const issueOptions = useMemo(() => statusOptions(RECONCILIATION_ISSUE), []);
  const collectionOptions = useMemo(() => statusOptions(COLLECTION_STATE), []);

  const pickerValue: [Dayjs | null, Dayjs | null] | null =
    list.filters.from && list.filters.to
      ? [dayjs(list.filters.from), dayjs(list.filters.to)]
      : null;

  return (
    <ListPage<ReconciliationFinding>
      title="Đối chiếu dòng tiền"
      subtitle="So khớp số tiền đã thu với nghĩa vụ của đơn, dựa trên payment và refund đã lưu."
      rowKey="orderId"
      summary={
        <>
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={8} xl={4}>
              <KpiCard
                label="Đơn đã quét"
                value={data ? formatNumber(scanned) : "—"}
                hint="Toàn bộ đơn trong khoảng thời gian đang lọc"
              />
            </Col>
            <Col xs={12} sm={8} xl={4}>
              <KpiCard
                label="Đơn có chênh lệch"
                value={summary ? formatNumber(summary.ordersWithFindings) : "—"}
                tone={(summary?.ordersWithFindings ?? 0) > 0 ? "warning" : "success"}
              />
            </Col>
            <Col xs={12} sm={8} xl={4}>
              <KpiCard
                label="Không phát hiện chênh lệch"
                value={data ? formatNumber(withoutFindings) : "—"}
                tone="success"
                hint="Không đồng nghĩa đã thu đủ tiền"
              />
            </Col>
            <Col xs={12} sm={12} xl={6}>
              <KpiCard
                label="Còn phải thu"
                value={summary ? formatMoney(summary.totals.outstanding) : "—"}
                tone={(summary?.totals.outstanding ?? 0) > 0 ? "error" : "success"}
                hint={summary ? `Đã thu ${formatMoney(summary.totals.collected)}` : undefined}
              />
            </Col>
            <Col xs={12} sm={12} xl={6}>
              <KpiCard
                label="Cần hoàn trả"
                value={summary ? formatMoney(summary.totals.refundDue) : "—"}
                tone={(summary?.totals.refundDue ?? 0) > 0 ? "warning" : "success"}
                hint="Tiền đã thu vượt công nợ hiệu lực"
              />
            </Col>
          </Row>

          <div style={{ marginTop: 12 }}>
            <Space wrap size={[8, 8]}>
              <Typography.Text type="secondary">Loại vấn đề:</Typography.Text>
              {issueOptions.map((option) => (
                <Tag.CheckableTag
                  key={option.value}
                  checked={activeIssue === option.value}
                  onChange={() =>
                    list.setFilter(
                      "issue",
                      activeIssue === option.value ? undefined : option.value,
                    )
                  }
                >
                  {option.label}
                  {summary ? ` (${formatNumber(summary.byIssue[option.value as ReconciliationIssue])})` : ""}
                </Tag.CheckableTag>
              ))}
            </Space>
            <div style={{ marginTop: 8 }}>
              <Space wrap size={[8, 8]}>
                <Typography.Text type="secondary">Mức thu:</Typography.Text>
                {collectionOptions.map((option) => (
                  <Tag.CheckableTag
                    key={option.value}
                    checked={activeCollection === option.value}
                    onChange={() => pickCollection(option.value)}
                  >
                    {option.label}
                    {summary
                      ? ` (${formatNumber(summary.byCollection[option.value as keyof typeof summary.byCollection])})`
                      : ""}
                  </Tag.CheckableTag>
                ))}
              </Space>
            </div>
          </div>
        </>
      }
      notice={
        <Alert
          type="info"
          showIcon
          title="Chỉ đọc — không điều chỉnh tiền tại đây"
          description={
            <span>
              Số liệu do API tính từ payment và refund đã lưu; màn hình này không sửa, không
              tạo và không xoá khoản tiền nào. Chênh lệch được xử lý qua luồng thu tiền/hoàn
              tiền thông thường để nhật ký kiểm toán giải thích được số dư mới.
            </span>
          }
        />
      }
      searchValue={list.search}
      onSearchChange={list.setSearch}
      searchPlaceholder="Tìm theo mã đơn"
      filters={[
        {
          key: "status",
          placeholder: "Trạng thái đơn",
          value: list.filters.status,
          options: statusOptions(ORDER_STATUS),
        },
        {
          key: "refundState",
          placeholder: "Hoàn tiền",
          value: list.filters.refundState,
          options: statusOptions(RECONCILIATION_REFUND_STATE),
        },
      ]}
      onFilterChange={list.setFilter}
      onReset={list.reset}
      toolbarExtra={
        <Space wrap size={[8, 8]}>
          <RangePicker
            allowClear
            format="DD/MM/YYYY"
            placeholder={["Từ ngày", "Đến ngày"]}
            value={pickerValue}
            onChange={(value) => {
              const { from, to } = rangeToFilters(value as [Dayjs | null, Dayjs | null] | null);
              list.setFilter("from", from);
              list.setFilter("to", to);
            }}
          />
          <Checkbox
            checked={includeMatched}
            onChange={(event) =>
              list.setFilter("includeMatched", event.target.checked ? "true" : undefined)
            }
          >
            Hiện cả đơn không có chênh lệch
          </Checkbox>
        </Space>
      }
      columns={columns}
      data={data?.findings ?? []}
      loading={isLoading}
      error={isError ? new Error("Không tải được báo cáo đối chiếu.") : undefined}
      onRetry={() => void refetch()}
      emptyText="Không có đơn nào khớp bộ lọc đối chiếu"
      total={data?.meta.total ?? 0}
      page={list.page}
      limit={list.limit}
      onPageChange={list.setPage}
      onLimitChange={list.setLimit}
      scrollX={1560}
      itemLabel="đơn"
      expandable={{
        expandedRowRender: (row) => <ReconciliationDetail row={row} />,
      }}
    />
  );
}
