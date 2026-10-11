"use client";

import { useState } from "react";
import { App, Button, DatePicker, Form, Input, InputNumber, Select } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { ListPage } from "@/components/common/ListPage";
import { StatusTag } from "@/components/common/StatusTag";
import { FormModal } from "@/components/common/FormModal";
import { useListState } from "@/hooks/useListState";
import { useListQuery } from "@/hooks/useListQuery";
import { useAction } from "@/hooks/useAction";
import { useVariantOptions } from "@/hooks/useOptions";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { num } from "@/lib/format/form";
import { RECORD_STATUS, recordStatus, statusOptions } from "@/lib/status";
import type { FlashSale } from "@/types/api";

type FlashItem = {
  productVariantId?: number;
  flashPrice?: number;
  quota?: number;
  perCustomerLimit?: number;
};

type FlashForm = {
  name: string;
  period: [Dayjs, Dayjs];
  status: string;
  items: FlashItem[];
};

export default function FlashSalesPage() {
  const list = useListState();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FlashForm>();
  const variants = useVariantOptions();
  const { modal } = App.useApp();

  const { data, isLoading, isError, refetch } = useListQuery<FlashSale>(
    queryKeys.flashSales(list.params),
    resources.flashSales,
    list.params,
  );

  const setStatus = useAction(
    (vars: { id: number; status: "ACTIVE" | "INACTIVE" }) =>
      resources.updateFlashSaleStatus(vars.id, vars.status),
    {
      invalidate: [["flash-sales"]],
      successMessage: "Đã cập nhật trạng thái flash sale.",
    },
  );

  const confirmDeactivate = (row: FlashSale) => {
    modal.confirm({
      title: "Ngừng flash sale này?",
      content: "Các sản phẩm trong chương trình sẽ trở về giá thường.",
      okText: "Ngừng",
      okType: "danger",
      cancelText: "Hủy",
      onOk: () => setStatus.mutate({ id: row.id, status: "INACTIVE" }),
    });
  };

  const create = useAction(
    (values: FlashForm) => {
      const [startsAt, endsAt] = values.period;
      return resources.createFlashSale({
        name: values.name,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status: values.status,
        items: values.items.map((i) => ({
          productVariantId: num(i.productVariantId),
          flashPrice: num(i.flashPrice),
          quota: num(i.quota),
          perCustomerLimit: num(i.perCustomerLimit),
        })),
      });
    },
    {
      invalidate: [["flash-sales"]],
      successMessage: "Đã tạo flash sale.",
      onSuccess: () => {
        setOpen(false);
        form.resetFields();
      },
    },
  );

  const columns: ColumnsType<FlashSale> = [
    { title: "Chương trình", dataIndex: "name" },
    {
      title: "Số sản phẩm",
      align: "right",
      width: 120,
      render: (_, row) => formatNumber(row.items?.length ?? 0),
    },
    {
      title: "Hiệu lực",
      render: (_, row) => (
        <span className="agri-nowrap">
          {formatDateTime(row.startsAt)} – {formatDateTime(row.endsAt)}
        </span>
      ),
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      render: (s: string) => <StatusTag status={recordStatus(s)} />,
    },
    {
      title: "Sản phẩm",
      render: (_, row) => (
        <span className="agri-muted" style={{ fontSize: 12 }}>
          {(row.items ?? [])
            .map((i) => `${i.productVariant?.name ?? `#${i.productVariantId}`} (${formatMoney(i.flashPrice)})`)
            .join(" · ") || "—"}
        </span>
      ),
    },
    {
      title: "Thao tác",
      width: 120,
      fixed: "right",
      render: (_, row) =>
        row.status === "ACTIVE" ? (
          <Button
            type="link"
            size="small"
            danger
            style={{ paddingInline: 0 }}
            onClick={() => confirmDeactivate(row)}
          >
            Ngừng
          </Button>
        ) : (
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0 }}
            loading={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: row.id, status: "ACTIVE" })}
          >
            Kích hoạt
          </Button>
        ),
    },
  ];

  return (
    <>
      <ListPage<FlashSale>
        title="Flash Sale"
        searchValue={list.search}
        onSearchChange={list.setSearch}
        hideSearch
        filters={[
          {
            key: "status",
            placeholder: "Trạng thái",
            value: list.filters.status,
            options: statusOptions(RECORD_STATUS),
          },
        ]}
        onFilterChange={list.setFilter}
        onReset={list.reset}
        toolbarExtra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Thêm flash sale
          </Button>
        }
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={isError ? new Error("Không tải được danh sách flash sale.") : undefined}
        onRetry={() => void refetch()}
        emptyText="Không có flash sale phù hợp"
        total={data?.meta.total ?? 0}
        page={list.page}
        limit={list.limit}
        onPageChange={list.setPage}
        onLimitChange={list.setLimit}
        scrollX={1200}
        itemLabel="chương trình"
      />

      <FormModal
        open={open}
        title="Thêm flash sale"
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={(values) => create.mutate(values)}
        submitting={create.isPending}
        width={720}
      >
        <Form.Item label="Tên chương trình" name="name" rules={[{ required: true, message: "Nhập tên." }]}>
          <Input placeholder="VD: Flash Sale cuối tuần Hưng Yên" />
        </Form.Item>
        <Form.Item label="Thời gian" name="period" rules={[{ required: true, message: "Chọn thời gian." }]}>
          <DatePicker.RangePicker showTime style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Trạng thái" name="status" initialValue="ACTIVE">
          <Select options={statusOptions(RECORD_STATUS)} />
        </Form.Item>

        <Form.List
          name="items"
          initialValue={[{ perCustomerLimit: 1, quota: 1 }]}
          rules={[
            {
              validator: async (_, value: FlashItem[]) => {
                if (!value || value.length < 1) {
                  throw new Error("Cần ít nhất một sản phẩm.");
                }
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>Sản phẩm áp dụng</div>
              {fields.map(({ key, name, ...rest }, index) => (
                <div
                  key={key}
                  style={{
                    border: "1px solid #f0f0f0",
                    borderRadius: 8,
                    padding: "12px 12px 0",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>Sản phẩm {index + 1}</span>
                    {fields.length > 1 ? (
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<MinusCircleOutlined />}
                        aria-label={`Xóa sản phẩm ${index + 1}`}
                        onClick={() => remove(name)}
                      />
                    ) : null}
                  </div>
                  <Form.Item
                    {...rest}
                    label="Quy cách bán"
                    name={[name, "productVariantId"]}
                    rules={[{ required: true, message: "Chọn quy cách bán." }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={variants.isLoading}
                      options={variants.data}
                      placeholder="Chọn sản phẩm — quy cách"
                    />
                  </Form.Item>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      columnGap: 12,
                    }}
                  >
                    <Form.Item
                      {...rest}
                      label="Giá flash (đ)"
                      name={[name, "flashPrice"]}
                      rules={[
                        { required: true, message: "Nhập giá flash." },
                        {
                          validator: async (_, value) => {
                            if (value === undefined || value === null || value === "") return;
                            if (!Number.isFinite(Number(value)) || Number(value) < 0) {
                              throw new Error("Giá flash phải là số không âm.");
                            }
                          },
                        },
                      ]}
                    >
                      <InputNumber min={0} style={{ width: "100%" }} placeholder="VD: 25000" />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      label="Số lượng ưu đãi"
                      name={[name, "quota"]}
                      rules={[
                        { required: true, message: "Nhập số lượng ưu đãi." },
                        {
                          validator: async (_, value) => {
                            if (value === undefined || value === null || value === "") return;
                            if (!Number.isInteger(Number(value)) || Number(value) < 1) {
                              throw new Error("Số lượng ưu đãi là số nguyên ≥ 1.");
                            }
                          },
                        },
                      ]}
                    >
                      <InputNumber min={1} step={1} precision={0} style={{ width: "100%" }} placeholder="VD: 100" />
                    </Form.Item>
                    <Form.Item
                      {...rest}
                      label="Giới hạn mỗi khách"
                      name={[name, "perCustomerLimit"]}
                      dependencies={[["items", name, "quota"]]}
                      rules={[
                        { required: true, message: "Nhập giới hạn mỗi khách." },
                        {
                          validator: async (_, value) => {
                            if (value === undefined || value === null || value === "") return;
                            if (!Number.isInteger(Number(value)) || Number(value) < 1) {
                              throw new Error("Giới hạn mỗi khách là số nguyên ≥ 1.");
                            }
                            const quota = form.getFieldValue(["items", name, "quota"]);
                            if (quota !== undefined && quota !== null && Number(value) > Number(quota)) {
                              throw new Error("Giới hạn mỗi khách không vượt quá số lượng ưu đãi.");
                            }
                          },
                        },
                      ]}
                    >
                      <InputNumber min={1} step={1} precision={0} style={{ width: "100%" }} placeholder="VD: 1" />
                    </Form.Item>
                  </div>
                </div>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                Thêm sản phẩm
              </Button>
              <Form.ErrorList errors={errors} />
            </div>
          )}
        </Form.List>
      </FormModal>
    </>
  );
}
