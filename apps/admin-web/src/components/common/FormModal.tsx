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
 *
 * `forceRender` keeps the inner `<Form>` mounted while the dialog is closed.
 * Without it the modal body is mounted lazily on the first open, so an
 * `openEdit` handler that calls `form.setFieldsValue(...)` before flipping
 * `open` writes into a store that no `<Form>` is connected to yet: antd logs
 * "Instance created by `useForm` is not connected to any Form element" and the
 * values are wiped the moment the fields register (they have no
 * `initialValues` to fall back on), leaving the edit form empty.
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
      forceRender
      mask={{ closable: false }}
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
