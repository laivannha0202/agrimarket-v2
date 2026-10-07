"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form, Input, Modal, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { useFarmOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDate } from "@/lib/format";
import {
  CERTIFICATE_STATUS,
  certificateStatus,
  recordStatus,
  statusOptions,
} from "@/lib/status";
import type { Certificate } from "@/types/api";

const VERIFY_OPTIONS = [
  { value: "VERIFIED", label: "Đã xác minh" },
  { value: "REJECTED", label: "Từ chối" },
  { value: "PENDING", label: "Chờ xác minh" },
];

export default function CertificatesPage() {
  const list = useListState();
  const [createOpen, setCreateOpen] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<Certificate | null>(null);
  const [createForm] = Form.useForm();
  const [verifyForm] = Form.useForm();
  const farms = useFarmOptions();

  const { data, isLoading, isError, refetch } = useListQuery<Certificate>(
    queryKeys.certificates(list.params),
    resources.certificates,
    list.params,
  );

  const create = useAction((values: Record<string, unknown>) => resources.createCertificate(values), {
    invalidate: [["certificates"]],
    successMessage: "Đã đăng ký chứng nhận.",
    onSuccess: () => {
      setCreateOpen(false);
      createForm.resetFields();
    },
  });

  const verify = useAction(
    (vars: { id: number; verificationStatus: string; rejectionReason?: string }) =>
      resources.verifyCertificate(vars.id, {
        verificationStatus: vars.verificationStatus,
        rejectionReason: vars.rejectionReason,
      }),
    {
      invalidate: [["certificates"]],
      successMessage: "Đã cập nhật xác minh chứng nhận.",
      onSuccess: () => {
        setVerifyTarget(null);
        verifyForm.resetFields();
      },
    },
  );

  const columns: ColumnsType<Certificate> = [
    {
      title: "Chứng nhận",
      render: (_, row) => (
        <div>
          <div>{row.type}</div>
          <div className="agri-muted agri-mono" style={{ fontSize: 12 }}>
            {row.certificateCode}
          </div>
        </div>
      ),
    },
    {
      title: "Trang trại",
      render: (_, row) =>
        row.farm ? (
          <Link href={`/farms/${row.farm.id}`} className="agri-link">
            {row.farm.name}
          </Link>
        ) : (
          "—"
        ),
    },
    { title: "Đơn vị cấp", dataIndex: "issuer" },
    { title: "Hiệu lực đến", dataIndex: "expiresAt", render: (v: string) => formatDate(v) },
    {
      title: "Xác minh",
      dataIndex: "verificationStatus",
      render: (s: string) => <StatusTag status={certificateStatus(s)} />,
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
            setVerifyTarget(row);
            verifyForm.setFieldsValue({
              verificationStatus:
                row.verificationStatus === "PENDING" ? "VERIFIED" : row.verificationStatus,
            });
          }}
        >
          Xác minh
        </Button>
      ),
    },
  ];

  const verifyStatus = Form.useWatch("verificationStatus", verifyForm);

  return (
    <>
      <ListPage<Certificate>
        title="Chứng nhận"
        subtitle="Chứng nhận chất lượng theo trang trại"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái xác minh",
            value: list.filters.status,
            options: statusOptions(CERTIFICATE_STATUS),
            width: 200,
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Thêm chứng nhận
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách chứng nhận.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có chứng nhận phù hợp"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1040}
        itemLabel="chứng nhận"
      />

      <FormModal
        open={createOpen}
        title="Thêm chứng nhận"
        form={createForm}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(values) => create.mutate(values)}
        submitting={create.isPending}
        width={560}
      >
        <Form.Item label="Trang trại" name="farmId" rules={[{ required: true, message: "Chọn trang trại." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={farms.isLoading}
            options={farms.data}
            placeholder="Chọn trang trại"
          />
        </Form.Item>
        <Form.Item label="Loại chứng nhận" name="type" rules={[{ required: true, message: "Nhập loại chứng nhận." }]}>
          <Input placeholder="VD: VietGAP" />
        </Form.Item>
        <Form.Item
          label="Số chứng nhận"
          name="certificateCode"
          rules={[{ required: true, message: "Nhập số chứng nhận." }]}
        >
          <Input placeholder="VD: VG-HY-2026-014" />
        </Form.Item>
        <Form.Item label="Đơn vị cấp" name="issuer" rules={[{ required: true, message: "Nhập đơn vị cấp." }]}>
          <Input placeholder="VD: Trung tâm Kiểm định Hưng Yên" />
        </Form.Item>
        <Form.Item label="Ngày cấp" name="issuedAt" rules={[{ required: true, message: "Chọn ngày cấp." }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item label="Ngày hết hạn" name="expiresAt" rules={[{ required: true, message: "Chọn ngày hết hạn." }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item label="Đường dẫn tệp" name="fileUrl">
          <Input placeholder="https://..." />
        </Form.Item>
      </FormModal>

      <Modal
        open={!!verifyTarget}
        title="Xác minh chứng nhận"
        onCancel={() => setVerifyTarget(null)}
        onOk={() => verifyForm.submit()}
        confirmLoading={verify.isPending}
        okText="Xác nhận"
        cancelText="Hủy"
        destroyOnHidden
      >
        {verifyTarget ? (
          <p className="agri-muted" style={{ marginTop: 0 }}>
            {verifyTarget.type} — <span className="agri-mono">{verifyTarget.certificateCode}</span>
            {" · "}
            trạng thái hiện tại: {recordStatus(verifyTarget.status).label}
          </p>
        ) : null}
        <Form
          form={verifyForm}
          layout="vertical"
          requiredMark={false}
          onFinish={(values: { verificationStatus: string; rejectionReason?: string }) => {
            if (!verifyTarget) return;
            verify.mutate({
              id: verifyTarget.id,
              verificationStatus: values.verificationStatus,
              rejectionReason: values.rejectionReason,
            });
          }}
        >
          <Form.Item
            label="Trạng thái xác minh"
            name="verificationStatus"
            rules={[{ required: true, message: "Chọn trạng thái." }]}
          >
            <Select options={VERIFY_OPTIONS} />
          </Form.Item>
          {verifyStatus === "REJECTED" ? (
            <Form.Item
              label="Lý do từ chối"
              name="rejectionReason"
              rules={[{ required: true, message: "Nhập lý do từ chối." }]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </>
  );
}
