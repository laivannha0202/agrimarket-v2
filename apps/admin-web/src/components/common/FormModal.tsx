"use client";

import type { ReactNode } from "react";
import { Form, Modal } from "antd";
import type { FormInstance } from "antd";

interface FormModalProps<TValues extends Record<string, unknown> = Record<string, unknown>> {
  open: boolean;
  title: string;
  form: FormInstance<TValues>;
  onCancel: () => void;
  onSubmit: (values: TValues) => void;
  submitting?: boolean;
  okText?: string;
  width?: number;
  children: ReactNode;
}

/**
 * Consistent create/edit dialog: antd Modal wrapping a vertical Form whose
 * submit button triggers the Form's own validation.
 */
export function FormModal<TValues extends Record<string, unknown> = Record<string, unknown>>({
  open,
  title,
  form,
  onCancel,
  onSubmit,
  submitting,
  okText = "Lưu",
  width = 560,
  children,
}: FormModalProps<TValues>) {
  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={submitting}
      okText={okText}
      cancelText="Hủy"
      width={width}
      destroyOnHidden
      maskClosable={false}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={onSubmit}
        preserve={false}
        style={{ marginTop: 8 }}
      >
        {children}
      </Form>
    </Modal>
  );
}
