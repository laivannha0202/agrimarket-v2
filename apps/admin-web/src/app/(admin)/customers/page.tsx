"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form, Input, Modal, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { useListState } from "@/hooks/useListState";
import { useClientList } from "@/hooks/useClientList";
import { useAction } from "@/hooks/useAction";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime } from "@/lib/format";
import { USER_STATUS, userStatus, statusOptions } from "@/lib/status";
import type { Customer } from "@/types/api";

const ROLE_OPTIONS = [
  { value: "CUSTOMER", label: "Khách hàng" },
  { value: "ADMIN", label: "Quản trị viên" },
];

// /customers only whitelists page/limit/search/status, so the role filter is
// applied in the browser.
const customerSearchText = (c: Customer) => [c.fullName, c.email, c.phone ?? ""].join(" ");

const customerFilter = (c: Customer, filters: Record<string, string | undefined>) => {
  if (filters.role && c.role !== filters.role) return false;
  if (filters.status && c.status !== filters.status) return false;
  return true;
};

export default function CustomersPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const { data, total, isLoading, isError, refetch } = useClientList<Customer>({
    queryKey: queryKeys.customers({ scope: "admin-list" }),
    fetcher: resources.customers,
    state: list,
    searchText: customerSearchText,
    filter: customerFilter,
  });

  const create = useAction((values: Record<string, unknown>) => resources.createCustomer(values), {
    invalidate: [["customers"]],
    successMessage: "Đã tạo người dùng.",
    onSuccess: () => {
      setOpen(false);
      form.resetFields();
    },
  });

  const toggle = useAction(
    (vars: { id: number; activate: boolean }) =>
      vars.activate
        ? resources.activateCustomer(vars.id)
        : resources.deactivateCustomer(vars.id),
    {
      invalidate: [["customers"]],
      successMessage: "Đã cập nhật trạng thái người dùng.",
    },
  );

  const columns: ColumnsType<Customer> = [
    {
      title: "Khách hàng",
      render: (_, row) => (
        <div>
          <Link href={`/customers/${row.id}`} className="agri-link">
            {row.fullName}
          </Link>
          <div className="agri-muted" style={{ fontSize: 12 }}>
            {row.email}
          </div>
        </div>
      ),
    },
    { title: "Điện thoại", dataIndex: "phone", render: (v: string | null) => v ?? "—" },
    {
      title: "Vai trò",
      dataIndex: "role",
      render: (r: string) => (r === "ADMIN" ? "Quản trị viên" : "Khách hàng"),
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={userStatus(s)} />,
    },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      render: (v: string) => <span className="agri-nowrap">{formatDateTime(v)}</span>,
    },
    {
      title: "Thao tác",
      width: 130,
      fixed: "right",
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0 }}
          loading={toggle.isPending}
          onClick={() => toggle.mutate({ id: row.id, activate: row.status !== "ACTIVE" })}
        >
          {row.status === "ACTIVE" ? "Khóa" : "Mở khóa"}
        </Button>
      ),
    },
  ];

  return (
    <>
      <ListPage<Customer>
        title="Khách hàng"
        subtitle="Người dùng và quản trị viên"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Tìm theo tên, email, số điện thoại..."
        filters={[
          {
            key: "role",
            placeholder: "Vai trò",
            value: list.filters.role,
            options: ROLE_OPTIONS,
          },
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(USER_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Thêm người dùng
          </Button>
        }
        columns={columns}
        data={data}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách khách hàng.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có khách hàng phù hợp"
        total={total}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1080}
        itemLabel="người dùng"
      />

      <Modal
        open={open}
        title="Thêm người dùng"
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText="Tạo"
        cancelText="Hủy"
        destroyOnHidden
        maskClosable={false}
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ role: "CUSTOMER", status: "ACTIVE" }}
          onFinish={(values: Record<string, unknown>) => create.mutate(values)}
        >
          <Form.Item label="Họ tên" name="fullName" rules={[{ required: true, message: "Nhập họ tên." }]}>
            <Input placeholder="VD: Trần Văn An" />
          </Form.Item>
          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: true, message: "Nhập email." },
              { type: "email", message: "Email không hợp lệ." },
            ]}
          >
            <Input placeholder="VD: khachhang@agrimarket.vn" />
          </Form.Item>
          <Form.Item
            label="Mật khẩu"
            name="password"
            rules={[
              { required: true, message: "Nhập mật khẩu." },
              { min: 6, message: "Mật khẩu tối thiểu 6 ký tự." },
            ]}
          >
            <Input.Password placeholder="Tối thiểu 6 ký tự" />
          </Form.Item>
          <Form.Item label="Số điện thoại" name="phone">
            <Input placeholder="VD: 0901234567" />
          </Form.Item>
          <Form.Item label="Vai trò" name="role">
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item label="Trạng thái" name="status">
            <Select options={statusOptions(USER_STATUS)} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
