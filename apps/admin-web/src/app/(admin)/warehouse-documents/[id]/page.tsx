"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Form, Input, Modal, Select, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleOutlined, DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { DetailPage, DetailCard } from "@/components/common/DetailPage";
import { FormModal } from "@/components/common/FormModal";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import { StatusTag } from "@/components/common/StatusTag";
import { useDetailQuery } from "@/hooks/useDetailQuery";
import { useAction } from "@/hooks/useAction";
import { useLotOptions, useVariantOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { num } from "@/lib/format/form";
import { warehouseDocStatus, warehouseDocType } from "@/lib/status";
import type { WarehouseDocument, WarehouseDocumentLine } from "@/types/api";

interface DocLineForm {
  productLotId?: number;
  productVariantId?: number;
  quantity?: number;
  unit?: string;
}

export default function WarehouseDocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const lots = useLotOptions(editOpen);
  const variants = useVariantOptions(editOpen);

  const { data: doc, isLoading, isError, refetch } = useDetailQuery<WarehouseDocument>(
    queryKeys.warehouseDocument(id),
    () => resources.warehouseDocument(id),
  );

  const complete = useAction(() => resources.completeWarehouseDocument(id), {
    invalidate: [queryKeys.warehouseDocument(id), ["warehouse-documents"], ["inventory"], ["movements"]],
    successMessage: "Đã hoàn thành phiếu kho và cập nhật tồn kho.",
  });

  const cancelDoc = useAction(() => resources.cancelWarehouseDocument(id), {
    invalidate: [queryKeys.warehouseDocument(id), ["warehouse-documents"]],
    successMessage: "Đã hủy phiếu nháp.",
  });

  const saveDraft = useAction(
    (values: { note?: string; lines?: DocLineForm[] }) => {
      const body: Record<string, unknown> = {};
      if (values.note !== undefined) body.note = values.note;
      if (values.lines !== undefined) {
        body.lines = values.lines.map((l) => ({
          productLotId: num(l.productLotId),
          productVariantId: num(l.productVariantId),
          quantity: num(l.quantity),
          unit: l.unit,
        }));
      }
      return resources.updateWarehouseDocument(id, body);
    },
    {
      invalidate: [queryKeys.warehouseDocument(id), ["warehouse-documents"]],
      successMessage: "Đã lưu phiếu nháp.",
      onSuccess: () => {
        setEditOpen(false);
      },
    },
  );

  useEffect(() => {
    if (editOpen && doc) {
      editForm.setFieldsValue({
        note: doc.note ?? undefined,
        lines: (doc.lines ?? []).map((l) => ({
          productLotId: l.productLotId,
          productVariantId: l.productVariantId,
          quantity: Number(l.quantity),
          unit: l.unit,
        })),
      });
    }
  }, [editOpen, doc, editForm]);

  const confirmCancel = () => {
    Modal.confirm({
      title: "Hủy phiếu nháp?",
      content: "Phiếu đã hủy không thể hoàn thành hay sửa tiếp, nhưng vẫn xem được lịch sử.",
      okText: "Hủy phiếu",
      okType: "danger",
      cancelText: "Giữ lại",
      onOk: () => cancelDoc.mutate(),
    });
  };

  const lineColumns: ColumnsType<WarehouseDocumentLine> = [
    {
      title: "Lô hàng",
      render: (_, row) => (
        <Link href={`/lots/${row.productLotId}`} className="agri-link agri-mono">
          {row.productLot?.code ?? `#${row.productLotId}`}
        </Link>
      ),
    },
    {
      title: "Quy cách bán",
      render: (_, row) =>
        row.productVariant ? (
          <span>
            {row.productVariant.name}{" "}
            <span className="agri-muted agri-mono" style={{ fontSize: 12 }}>
              {row.productVariant.sku}
            </span>
          </span>
        ) : (
          <span className="agri-mono">#{row.productVariantId}</span>
        ),
    },
    {
      title: "Số lượng",
      dataIndex: "quantity",
      align: "right",
      render: (v: string, row) => <span className="agri-nowrap">{formatQuantity(v, row.unit)}</span>,
    },
  ];

  const isDraft = doc?.status === "DRAFT";
  const hasSource = Boolean(doc?.sourceType);
  const canEdit = isDraft && !hasSource;

  return (
    <>
      <DetailPage
        title={doc ? `Phiếu kho ${doc.code}` : "Chi tiết phiếu kho"}
        subtitle={
          doc
            ? doc.completedAt
              ? `Ngày chứng từ ${formatDateTime(doc.completedAt)}`
              : doc.status === "CANCELLED"
                ? "Phiếu đã hủy — chỉ xem lịch sử"
                : "Phiếu nháp — chưa hoàn thành"
            : undefined
        }
        backHref="/warehouse-documents"
        backLabel="Danh sách phiếu kho"
        loading={isLoading}
        error={isError ? new Error("Không tải được phiếu kho.") : undefined}
        onRetry={() => void refetch()}
        extra={
          doc ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <StatusTag status={warehouseDocStatus(doc.status)} />
              {canEdit ? (
                <>
                  <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
                    Sửa nháp
                  </Button>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    loading={cancelDoc.isPending}
                    onClick={confirmCancel}
                  >
                    Hủy phiếu
                  </Button>
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    loading={complete.isPending}
                    onClick={() => complete.mutate()}
                  >
                    Hoàn thành phiếu
                  </Button>
                </>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {doc ? (
          <>
            <DetailCard title="Thông tin phiếu">
              <InfoDescriptions
                items={[
                  { key: "code", label: "Mã phiếu", children: <span className="agri-mono">{doc.code}</span> },
                  { key: "type", label: "Loại phiếu", children: <StatusTag status={warehouseDocType(doc.type)} /> },
                  { key: "warehouse", label: "Kho", children: doc.warehouse?.name ?? "—" },
                  {
                    key: "source",
                    label: "Nguồn",
                    children: doc.sourceType ? `${doc.sourceType} #${doc.sourceId ?? ""}` : "—",
                  },
                  {
                    key: "businessDate",
                    label: "Ngày chứng từ",
                    children: doc.completedAt ? formatDateTime(doc.completedAt) : "Chưa hoàn thành",
                  },
                  {
                    key: "created",
                    label: "Tạo bản ghi lúc",
                    children: formatDateTime(doc.createdAt),
                  },
                  { key: "note", label: "Ghi chú", span: 2, children: doc.note ?? "—" },
                ]}
              />
              {isDraft && hasSource ? (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                  Phiếu sinh tự động từ nghiệp vụ nguồn nên không sửa/hủy thủ công.
                </Typography.Paragraph>
              ) : null}
            </DetailCard>

            <DetailCard title="Dòng hàng">
              <Table<WarehouseDocumentLine>
                size="small"
                rowKey="id"
                columns={lineColumns}
                dataSource={doc.lines ?? []}
                pagination={false}
                locale={{ emptyText: "Không có dòng hàng" }}
              />
            </DetailCard>

            <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
              {isDraft
                ? "Phiếu nháp chưa làm thay đổi tồn kho. Hoàn thành phiếu sẽ áp dụng thay đổi tồn kho và không thể hoàn tác; hủy phiếu giữ lại lịch sử nhưng không bao giờ nhập kho."
                : doc.status === "CANCELLED"
                  ? "Phiếu đã hủy: không thể sửa hay hoàn thành, chỉ xem lịch sử."
                  : "Phiếu đã hoàn thành: không sửa, không xóa. Sai lệch thực tế xử lý bằng chứng từ điều chỉnh riêng."}
            </Typography.Paragraph>
          </>
        ) : null}
      </DetailPage>

      <FormModal
        open={editOpen}
        title="Sửa phiếu nháp"
        form={editForm}
        onCancel={() => setEditOpen(false)}
        onSubmit={(values) => saveDraft.mutate(values as { note?: string; lines?: DocLineForm[] })}
        submitting={saveDraft.isPending}
        width={720}
        okText="Lưu nháp"
      >
        <Form.Item label="Ghi chú" name="note">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>Dòng hàng</div>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item {...rest} name={[name, "productLotId"]} rules={[{ required: true, message: "Lô" }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={lots.isLoading}
                      options={lots.data}
                      placeholder="Lô hàng"
                      style={{ width: 200 }}
                    />
                  </Form.Item>
                  <Form.Item
                    {...rest}
                    name={[name, "productVariantId"]}
                    rules={[{ required: true, message: "Quy cách bán" }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={variants.isLoading}
                      options={variants.data}
                      placeholder="Quy cách bán"
                      style={{ width: 220 }}
                    />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "quantity"]} rules={[{ required: true, message: "SL" }]}>
                    <Input type="number" placeholder="Số lượng" style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "unit"]} rules={[{ required: true, message: "ĐV" }]}>
                    <Input placeholder="Đơn vị" style={{ width: 90 }} />
                  </Form.Item>
                  {fields.length > 1 ? (
                    <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} />
                  ) : null}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                Thêm dòng
              </Button>
            </div>
          )}
        </Form.List>
        <p className="agri-muted" style={{ margin: 0, fontSize: 12 }}>
          Sửa nháp không làm thay đổi tồn kho; tồn chỉ thay đổi khi hoàn thành phiếu.
        </p>
      </FormModal>
    </>
  );
}
