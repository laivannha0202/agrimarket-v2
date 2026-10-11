"use client";

import { useEffect, useMemo } from "react";
import { useState } from "react";
import { App, Button, Image, Space, Tag, Upload } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  PlusOutlined,
  StarFilled,
  StarOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { resources } from "@/lib/api/resources";
import type { ProductImage } from "@/types/api";

const ACCEPT = ".jpg,.jpeg,.png,.webp";
const MAX_FILES = 6;

/**
 * "Hình ảnh sản phẩm" section for the create/edit/detail screens.
 *
 * Immediate mode (`productId` set): every action calls the backend and then
 * `onRefresh` so the list always mirrors the server. Staging mode (create
 * page, no `productId` yet): files are held locally and handed to the parent
 * through `onStagedChange`; the parent uploads them right after creating the
 * product. Both modes share the same neutral placeholder for missing images.
 */
export function ProductImagesManager({
  productId,
  images,
  onRefresh,
  showHeading = true,
}: {
  productId: number | string;
  images: ProductImage[];
  onRefresh: () => void;
  /** Hide the inner heading when the parent card already provides one. */
  showHeading?: boolean;
}) {
  const { message, modal } = App.useApp();
  const [busy, setBusy] = useState(false);

  const sorted = [...(images ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onRefresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : `${label} thất bại.`);
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const next = [...sorted];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    void run("Sắp xếp ảnh", () =>
      resources.reorderProductImages(
        productId,
        next.map((i) => i.id),
      ),
    );
  };

  const remove = (image: ProductImage) => {
    modal.confirm({
      title: "Xóa ảnh này?",
      content: "Ảnh sẽ bị xóa khỏi sản phẩm.",
      okText: "Xóa",
      okType: "danger",
      cancelText: "Giữ lại",
      onOk: () => run("Xóa ảnh", () => resources.deleteProductImage(productId, image.id)),
    });
  };

  return (
    <div>
      {showHeading ? (
        <div style={{ marginBottom: 8, fontWeight: 500 }}>Hình ảnh sản phẩm</div>
      ) : null}
      {sorted.length === 0 ? (
        <div
          style={{
            border: "1px dashed #d9d9d9",
            borderRadius: 8,
            padding: 20,
            textAlign: "center",
            color: "#8c8c8c",
            background: "#fafafa",
          }}
        >
          Chưa có ảnh. Tải lên ảnh JPG, PNG hoặc WebP (tối đa {MAX_FILES} ảnh, mỗi ảnh ≤ 5 MB).
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {sorted.map((img, index) => (
            <div
              key={img.id}
              style={{
                width: 132,
                border: "1px solid #f0f0f0",
                borderRadius: 8,
                padding: 6,
                background: "#fff",
              }}
            >
              <Image
                src={img.url}
                alt={`Ảnh sản phẩm ${index + 1}`}
                width={118}
                height={118}
                style={{ objectFit: "cover", borderRadius: 4 }}
                fallback="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='118' height='118'%3E%3Crect width='118' height='118' fill='%23f5f5f5'/%3E%3Ctext x='59' y='63' font-size='11' text-anchor='middle' fill='%23bfbfbf'%3EChưa có ảnh%3C/text%3E%3C/svg%3E"
              />
              <div style={{ marginTop: 6, display: "flex", justifyContent: "center" }}>
                {img.isPrimary ? (
                  <Tag color="gold" icon={<StarFilled />} style={{ marginInlineEnd: 0 }}>
                    Ảnh đại diện
                  </Tag>
                ) : (
                  <Button
                    size="small"
                    type="link"
                    icon={<StarOutlined />}
                    disabled={busy}
                    onClick={() => run("Đặt ảnh đại diện", () => resources.setPrimaryImage(productId, img.id))}
                  >
                    Đặt đại diện
                  </Button>
                )}
              </div>
              <Space size={0} style={{ display: "flex", justifyContent: "center" }}>
                <Button
                  size="small"
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  aria-label="Chuyển sang trái"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                />
                <Button
                  size="small"
                  type="text"
                  icon={<ArrowRightOutlined />}
                  aria-label="Chuyển sang phải"
                  disabled={busy || index === sorted.length - 1}
                  onClick={() => move(index, 1)}
                />
                <Upload
                  accept={ACCEPT}
                  showUploadList={false}
                  disabled={busy}
                  customRequest={async (options) => {
                    const file = options.file as File;
                    await run("Thay ảnh", () => resources.replaceProductImage(productId, img.id, file));
                  }}
                >
                  <Button size="small" type="text" icon={<SyncOutlined />} aria-label="Thay ảnh" disabled={busy} />
                </Upload>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label="Xóa ảnh"
                  disabled={busy}
                  onClick={() => remove(img)}
                />
              </Space>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <Upload
          accept={ACCEPT}
          multiple
          showUploadList={false}
          disabled={busy || sorted.length >= MAX_FILES}
          customRequest={async (options) => {
            const file = options.file as File;
            await run("Tải ảnh", () => resources.uploadProductImage(productId, file));
          }}
        >
          <Button icon={<PlusOutlined />} disabled={busy || sorted.length >= MAX_FILES}>
            Tải ảnh lên ({sorted.length}/{MAX_FILES})
          </Button>
        </Upload>
      </div>
    </div>
  );
}

/** Local file staging for the create page (uploads after the product exists). */
export function ProductImageStaging({
  value,
  onChange,
}: {
  value: File[];
  onChange: (files: File[]) => void;
}) {
  const fileList = useMemo(
    () =>
      value.map((f, i) => ({
        uid: `${i}-${f.name}-${f.size}`,
        name: f.name,
        status: "done" as const,
        url: URL.createObjectURL(f),
      })),
    [value],
  );

  useEffect(
    () => () => {
      for (const f of fileList) URL.revokeObjectURL(f.url);
    },
    [fileList],
  );

  return (
    <div>
      <div style={{ marginBottom: 8, fontWeight: 500 }}>Hình ảnh sản phẩm</div>
      <Upload
        accept={ACCEPT}
        multiple
        listType="picture-card"
        fileList={fileList}
        beforeUpload={(file) => {
          onChange([...value, file as unknown as File].slice(0, MAX_FILES));
          return false;
        }}
        onRemove={(file) => {
          onChange(value.filter((f) => `${value.indexOf(f)}-${f.name}-${f.size}` !== file.uid));
        }}
      >
        {value.length >= MAX_FILES ? null : (
          <div>
            <PlusOutlined />
            <div style={{ marginTop: 8 }}>Tải ảnh</div>
          </div>
        )}
      </Upload>
      <div style={{ color: "#8c8c8c", fontSize: 12 }}>
        Ảnh JPG, PNG hoặc WebP, mỗi ảnh ≤ 5 MB, tối đa {MAX_FILES} ảnh. Ảnh đầu tiên làm ảnh đại diện.
      </div>
    </div>
  );
}
