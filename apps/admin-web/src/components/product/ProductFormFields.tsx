"use client";

import { Button, Form, Input, Select, Space } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { useCategoryOptions, useFarmOptions, usePartnerOptions } from "@/hooks/useOptions";
import { RECORD_STATUS, statusOptions } from "@/lib/status";

/**
 * Product create/edit fields. `mode` controls whether the partner (immutable
 * after creation) and initial variants are editable — the backend only accepts
 * partnerId/categoryId/farmId/name/slug/description/status on update.
 */
export function ProductFormFields({ mode }: { mode: "create" | "edit" }) {
  const partners = usePartnerOptions();
  const categories = useCategoryOptions();
  const farms = useFarmOptions();

  return (
    <>
      <Form.Item label="Tên sản phẩm" name="name" rules={[{ required: true, message: "Nhập tên sản phẩm." }]}>
        <Input placeholder="VD: Cà chua bi đỏ" />
      </Form.Item>
      <Form.Item
        label="Slug"
        name="slug"
        rules={[
          { required: true, message: "Nhập slug." },
          { pattern: /^[a-z0-9-]+$/, message: "Slug chỉ gồm chữ thường, số và dấu gạch ngang." },
        ]}
        extra="Định danh không dấu, chỉ chữ thường, số và dấu gạch ngang."
      >
        <Input placeholder="ca-chua-bi-do" />
      </Form.Item>
      {mode === "create" ? (
        <Form.Item label="Đối tác" name="partnerId" rules={[{ required: true, message: "Chọn đối tác." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={partners.isLoading}
            options={partners.data}
            placeholder="Chọn đối tác"
          />
        </Form.Item>
      ) : null}
      <Form.Item label="Danh mục" name="categoryId" rules={[{ required: true, message: "Chọn danh mục." }]}>
        <Select
          showSearch
          optionFilterProp="label"
          loading={categories.isLoading}
          options={categories.data}
          placeholder="Chọn danh mục"
        />
      </Form.Item>
      <Form.Item label="Trang trại (tùy chọn)" name="farmId">
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          loading={farms.isLoading}
          options={farms.data}
          placeholder="Chọn trang trại"
        />
      </Form.Item>
      <Form.Item label="Mô tả" name="description">
        <Input.TextArea rows={3} placeholder="Mô tả ngắn về sản phẩm" />
      </Form.Item>
      <Form.Item label="Trạng thái" name="status" initialValue="ACTIVE">
        <Select options={statusOptions(RECORD_STATUS)} />
      </Form.Item>

      {mode === "create" ? (
        <Form.List name="variants">
          {(fields, { add, remove }) => (
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>Biến thể</div>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item {...rest} name={[name, "sku"]} rules={[{ required: true, message: "SKU" }]}>
                    <Input placeholder="SKU" style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "name"]} rules={[{ required: true, message: "Tên" }]}>
                    <Input placeholder="Tên biến thể" style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "saleUnit"]} rules={[{ required: true, message: "Đơn vị" }]}>
                    <Input placeholder="Đơn vị" style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "basePrice"]} rules={[{ required: true, message: "Giá" }]}>
                    <Input type="number" placeholder="Giá" style={{ width: 120 }} />
                  </Form.Item>
                  <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} />
                </Space>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                Thêm biến thể
              </Button>
            </div>
          )}
        </Form.List>
      ) : null}
    </>
  );
}
