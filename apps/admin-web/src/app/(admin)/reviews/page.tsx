"use client";

import { Button, Form, Modal, Rate, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime } from "@/lib/format";
import { REVIEW_STATUS, reviewStatus, statusOptions } from "@/lib/status";
import type { Review } from "@/types/api";

const REVIEW_TRANSITIONS: Record<string, { value: string; label: string }[]> = {
  PENDING: [
    { value: "APPROVED", label: "Công khai" },
    { value: "HIDDEN", label: "Ẩn" },
  ],
  APPROVED: [
    { value: "HIDDEN", label: "Ẩn" },
    { value: "PENDING", label: "Chờ duyệt" },
  ],
  HIDDEN: [
    { value: "APPROVED", label: "Công khai" },
    { value: "PENDING", label: "Chờ duyệt" },
  ],
};

export default function ReviewsPage() {
  const list = useListState();
  const [editing, setEditing] = useState<Review | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading, isError, refetch } = useListQuery<Review>(
    queryKeys.reviews(list.params),
    resources.reviews,
    list.params,
  );

  const update = useAction(
    (vars: { id: number; status: string }) => resources.updateReviewStatus(vars.id, vars.status),
    {
      invalidate: [["reviews"]],
      successMessage: "Đã cập nhật đánh giá.",
      onSuccess: () => setEditing(null),
    },
  );

  const columns: ColumnsType<Review> = [
    { title: "Sản phẩm", render: (_, row) => row.product?.name ?? `#${row.productId}` },
    { title: "Khách hàng", render: (_, row) => row.customer?.fullName ?? "—" },
    {
      title: "Đánh giá",
      dataIndex: "rating",
      render: (v: number) => <Rate disabled value={v} style={{ fontSize: 14 }} />,
    },
    { title: "Nội dung", dataIndex: "content", ellipsis: true, render: (v: string | null) => v ?? "—" },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={reviewStatus(s)} />,
    },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Thao tác",
      width: 110,
      fixed: "right",
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0 }}
          onClick={() => {
            setEditing(row);
            form.setFieldsValue({ status: (REVIEW_TRANSITIONS[row.status] ?? [])[0]?.value });
          }}
        >
          Duyệt
        </Button>
      ),
    },
  ];

  const transitions = editing ? REVIEW_TRANSITIONS[editing.status] ?? [] : [];

  return (
    <>
      <ListPage<Review>
        title="Đánh giá"
        subtitle="Đánh giá sản phẩm của khách hàng"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(REVIEW_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách đánh giá.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có đánh giá phù hợp"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1080}
        itemLabel="đánh giá"
      />

      <Modal
        open={!!editing}
        title="Duyệt đánh giá"
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={update.isPending}
        okText="Xác nhận"
        cancelText="Hủy"
        destroyOnHidden
      >
        {editing ? (
          <p className="agri-muted" style={{ marginTop: 0 }}>
            {editing.product?.name ?? `#${editing.productId}`} — {editing.rating}★
          </p>
        ) : null}
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(values: { status: string }) => {
            if (!editing) return;
            update.mutate({ id: editing.id, status: values.status });
          }}
        >
          <Form.Item label="Trạng thái mới" name="status" rules={[{ required: true, message: "Chọn trạng thái." }]}>
            <Select options={transitions} placeholder="Chọn trạng thái" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
