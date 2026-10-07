"use client";

import { useState } from "react";
import { Button, DatePicker, Form, Input, InputNumber, Select, Space } from "antd";
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

  const { data, isLoading, isError, refetch } = useListQuery<FlashSale>(
    queryKeys.flashSales(list.params),
    resources.flashSales,
    list.params,
  );

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
  ];

  return (
    <>
      <ListPage<FlashSale>
        title="Flash Sale"
        subtitle="Chương trình giảm giá nhanh theo khung giờ"
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
        scrollX={1080}
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
              <div style={{ marginBottom: 8, fontWeight: 500 }}>Sản phẩm</div>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item
                    {...rest}
                    name={[name, "productVariantId"]}
                    rules={[{ required: true, message: "Biến thể" }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={variants.isLoading}
                      options={variants.data}
                      placeholder="Biến thể"
                      style={{ width: 220 }}
                    />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "flashPrice"]} rules={[{ required: true, message: "Giá" }]}>
                    <InputNumber min={0} placeholder="Giá flash" style={{ width: 130 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "quota"]} rules={[{ required: true, message: "SL" }]}>
                    <InputNumber min={1} placeholder="Hạn mức" style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item
                    {...rest}
                    name={[name, "perCustomerLimit"]}
                    rules={[{ required: true, message: "Mỗi khách" }]}
                  >
                    <InputNumber min={1} placeholder="Mỗi khách" style={{ width: 110 }} />
                  </Form.Item>
                  {fields.length > 1 ? (
                    <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} />
                  ) : null}
                </Space>
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
