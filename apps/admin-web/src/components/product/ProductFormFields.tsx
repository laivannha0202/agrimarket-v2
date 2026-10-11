"use client";

import { Button, Form, Input, Select } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { useCategoryOptions, useFarmsForPartner, usePartnerOptions } from "@/hooks/useOptions";
import { RECORD_STATUS, statusOptions } from "@/lib/status";
import { suggestSku } from "@/lib/slug";

/**
 * Product create/edit fields, in operator order:
 * 1. Hình ảnh sản phẩm (rendered by the parent via `imageSection`)
 * 2. Tên sản phẩm
 * 3. Đơn vị bán hàng (create only — a product never changes its seller)
 * 4. Nhóm sản phẩm
 * 5. Trang trại
 * 6. Mô tả
 * 7. Quy cách bán (create only)
 * 8. Trạng thái
 *
 * Notes:
 * - The slug ("Đường dẫn sản phẩm") is generated from the name by the backend
 *   and is never entered by hand. On edit it is shown read-only so a rename
 *   never breaks existing links.
 * - No `initialValue` on Form.Item: the parent Form owns `initialValues`
 *   (create) or `setFieldsValue` (edit), so antd never warns about overwrite.
 */
export function ProductFormFields({
  mode,
  imageSection,
  partnerId,
}: {
  mode: "create" | "edit";
  imageSection?: React.ReactNode;
  /** Fixed seller (edit mode); in create mode the value is watched from the form. */
  partnerId?: number;
}) {
  const partners = usePartnerOptions();
  const categories = useCategoryOptions();
  const form = Form.useFormInstance();

  const watchedPartnerId = Form.useWatch("partnerId", form) as number | undefined;
  const effectivePartnerId = partnerId ?? watchedPartnerId;
  // Only farms belonging to the selected seller may be attached (the backend
  // rejects a cross-partner farm), so the dropdown mirrors that rule.
  const farms = useFarmsForPartner(effectivePartnerId);

  return (
    <>
      {imageSection}

      <Form.Item label="Tên sản phẩm" name="name" rules={[{ required: true, message: "Nhập tên sản phẩm." }]}>
        <Input placeholder="VD: Cà chua bi đỏ" />
      </Form.Item>

      {mode === "edit" ? (
        <Form.Item label="Đường dẫn sản phẩm" name="slug" extra="Hệ thống tạo tự động từ tên, không đổi khi sửa.">
          <Input disabled />
        </Form.Item>
      ) : null}

      {mode === "create" ? (
        <Form.Item label="Đơn vị bán hàng" name="partnerId" rules={[{ required: true, message: "Chọn đơn vị bán hàng." }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={partners.isLoading}
            options={partners.data}
            placeholder="Chọn đơn vị bán hàng"
          />
        </Form.Item>
      ) : null}

      <Form.Item label="Nhóm sản phẩm" name="categoryId" rules={[{ required: true, message: "Chọn nhóm sản phẩm." }]}>
        <Select
          showSearch
          optionFilterProp="label"
          loading={categories.isLoading}
          options={categories.data}
          placeholder="Chọn nhóm sản phẩm"
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

      {mode === "create" ? (
        <Form.List name="variants">
          {(fields, { add, remove }) => (
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>Quy cách bán</div>
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
                    <span style={{ fontWeight: 500 }}>Quy cách {index + 1}</span>
                    {fields.length > 1 ? (
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<MinusCircleOutlined />}
                        aria-label={`Xóa quy cách ${index + 1}`}
                        onClick={() => remove(name)}
                      />
                    ) : null}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      columnGap: 12,
                    }}
                  >
                    <Form.Item {...rest} label="Mã hàng" name={[name, "sku"]} rules={[{ required: true, message: "Nhập mã hàng." }]}>
                      <Input placeholder="VD: CCB-500G" />
                    </Form.Item>
                    <Form.Item {...rest} label="Tên quy cách" name={[name, "name"]} rules={[{ required: true, message: "Nhập tên quy cách." }]}>
                      <Input
                        placeholder="VD: Gói 500 g"
                        onChange={(e) => {
                          const row = form.getFieldValue(["variants", name]) ?? {};
                          if (!row.sku) {
                            form.setFieldValue(
                              ["variants", name, "sku"],
                              suggestSku(form.getFieldValue("name") ?? "", e.target.value),
                            );
                          }
                        }}
                      />
                    </Form.Item>
                    <Form.Item {...rest} label="Đơn vị bán" name={[name, "saleUnit"]} rules={[{ required: true, message: "Nhập đơn vị bán." }]}>
                      <Input placeholder="VD: gói" />
                    </Form.Item>
                    <Form.Item {...rest} label="Giá bán" name={[name, "basePrice"]} rules={[{ required: true, message: "Nhập giá bán." }]}>
                      <Input type="number" placeholder="VD: 32000" />
                    </Form.Item>
                    <Form.Item {...rest} label="Khối lượng" name={[name, "weight"]}>
                      <Input type="number" placeholder="VD: 500" />
                    </Form.Item>
                    <Form.Item {...rest} label="Đơn vị khối lượng" name={[name, "weightUnit"]}>
                      <Input placeholder="VD: g" />
                    </Form.Item>
                  </div>
                </div>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                Thêm quy cách bán
              </Button>
            </div>
          )}
        </Form.List>
      ) : null}

      <Form.Item label="Trạng thái" name="status">
        <Select options={statusOptions(RECORD_STATUS)} />
      </Form.Item>
    </>
  );
}
