"use client";

/**
 * Evidence photo picker — chọn tối đa 5 ảnh cho khiếu nại / trả hàng / đánh giá.
 *
 * Web twin of the Mobile app's `EvidencePicker`.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not upload on its own schedule and it does not report success. The
 * screen uploads when the customer presses "Gửi", waits for every file to come
 * back with an id, and only then calls the create endpoint with those ids. That
 * order is what makes the outcome honest: if an upload fails, no request is
 * created, the customer sees the failure, and the form keeps everything they
 * typed so they can retry.
 *
 * The alternative — uploading in the background as each photo is picked — would
 * mean holding ids for files the customer might then remove, and would make
 * "submit failed" ambiguous: some photos uploaded, some did not, and the
 * request was never created. Keeping the two steps adjacent removes that whole
 * class of half-state.
 *
 * The browser file input is the camera on a phone ("Thêm ảnh" opens the same
 * chooser), and the server still re-validates magic bytes, size and dimensions
 * and re-encodes every file — the client checks are feedback, never a trust
 * decision.
 */

import { Box, Group, Loader, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCamera, IconX } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { buildEvidenceFileName, MAX_EVIDENCE, rejectReasonForFile } from "@/lib/evidence";

export { MAX_EVIDENCE };

/**
 * One picked photo, before upload.
 *
 * `status` is what the UI shows: `pending` has not been tried, `uploading` is
 * in flight, `done` carries the server id, `error` can be retried. Keeping the
 * id here — rather than in a parallel array — means a photo and its uploaded id
 * can never drift apart when the customer removes one.
 */
export interface PickedEvidence {
  key: string;
  file: File;
  /** Object URL for the thumbnail; revoked when the photo is removed. */
  previewUrl: string;
  status: "pending" | "uploading" | "done" | "error";
  evidenceId?: number;
  error?: string;
}

/**
 * Uploads every photo that still needs one and returns the ordered ids.
 *
 * Called by the screen at submit time. Photos that already uploaded are not
 * re-sent, so pressing "Gửi" again after a failure only retries what failed —
 * a second attempt cannot create duplicate images on the server.
 *
 * Throws with a customer-readable message if any upload fails; the caller is
 * responsible for keeping the form intact and showing that message.
 */
export async function uploadEvidence(
  items: PickedEvidence[],
  onProgress: (items: PickedEvidence[]) => void,
  upload: (file: File) => Promise<{ id: number }>,
): Promise<number[]> {
  const working = [...items];
  const ids: number[] = [];

  for (let i = 0; i < working.length; i += 1) {
    const current = working[i]!;
    if (current.status === "done" && current.evidenceId !== undefined) {
      ids.push(current.evidenceId);
      continue;
    }

    working[i] = { ...current, status: "uploading", error: undefined };
    onProgress([...working]);

    try {
      // The API's file filter checks the *name's* extension before it even
      // looks at the bytes, and iOS happily hands over a JPEG named `.HEIC`.
      // Uploading a name that matches the file's real MIME type keeps that
      // check honest; the server still re-validates the bytes itself.
      const uploadName = buildEvidenceFileName(current.file, i);
      const file =
        current.file.name === uploadName
          ? current.file
          : new File([current.file], uploadName, { type: current.file.type });
      const result = await upload(file);
      working[i] = { ...working[i]!, status: "done", evidenceId: result.id };
      ids.push(result.id);
      onProgress([...working]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tải ảnh thất bại.";
      working[i] = { ...working[i]!, status: "error", error: message };
      onProgress([...working]);
      throw new Error(message);
    }
  }

  return ids;
}

export function EvidencePicker({
  items,
  onChange,
  disabled = false,
  label = "Ảnh minh chứng",
}: {
  items: PickedEvidence[];
  onChange: (items: PickedEvidence[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** Object URLs are revoked on unmount so a long session does not leak blobs. */
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(
    () => () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    },
    [],
  );

  /**
   * Turns raw picked files into `PickedEvidence`. Unsupported files are skipped
   * and reported in ONE notification (not one per file), so picking 5 files with
   * 1 bad GIF does not bury the 4 good ones.
   */
  const acceptFiles = (fileList: FileList | null, startIndex: number) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const skipped: string[] = [];
    const picked: PickedEvidence[] = [];
    for (const file of files) {
      if (rejectReasonForFile(file) !== null) {
        skipped.push(file.name || `ảnh ${startIndex + picked.length + 1}`);
        continue;
      }
      picked.push({
        key: `${Date.now()}-${startIndex + picked.length}-${file.name}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: "pending",
      });
    }

    if (picked.length > 0) onChange([...items, ...picked]);
    if (skipped.length > 0) {
      notifications.show({
        title: "Một số ảnh không thêm được",
        message: `${skipped.length} ảnh bị bỏ qua (chỉ nhận JPG, PNG, WebP; mỗi ảnh tối đa 5 MB). Các ảnh còn lại vẫn được giữ.`,
        color: "orange",
        icon: <IconAlertCircle size={16} />,
      });
    }
  };

  const removeAt = (key: string) => {
    const item = items.find((i) => i.key === key);
    if (item) URL.revokeObjectURL(item.previewUrl);
    onChange(items.filter((i) => i.key !== key));
  };

  const remaining = MAX_EVIDENCE - items.length;

  return (
    <Box>
      <Group justify="space-between" align="center">
        <Text fz={13} fw={600} c="var(--agri-text)" mt={8}>
          {label}
        </Text>
        <Text fz={12.5} c="var(--agri-muted)" mt={8}>
          {items.length}/{MAX_EVIDENCE}
        </Text>
      </Group>

      <Group gap={10} mt={8} align="flex-start">
        {items.map((item) => (
          <Box key={item.key} w={76} h={76} style={{ position: "relative", flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.previewUrl}
              alt="Ảnh đã chọn"
              className="agri-media"
              style={{
                width: 76,
                height: 76,
                borderRadius: 8,
                border: "1px solid var(--agri-border)",
                background: "var(--agri-page)",
              }}
            />

            {item.status === "uploading" ? (
              <Stack
                align="center"
                justify="center"
                gap={0}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 8,
                  background: "rgba(15,18,15,0.45)",
                }}
              >
                <Loader size={18} color="#ffffff" />
              </Stack>
            ) : null}

            {item.status === "error" ? (
              <Stack
                align="center"
                justify="center"
                gap={0}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 8,
                  background: "rgba(180,40,40,0.55)",
                }}
              >
                <IconAlertCircle size={18} color="#ffffff" aria-hidden />
              </Stack>
            ) : null}

            {!disabled ? (
              <Box
                component="button"
                type="button"
                onClick={() => removeAt(item.key)}
                aria-label="Xóa ảnh"
                className="agri-press"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  background: "var(--agri-text-strong)",
                  display: "grid",
                  placeItems: "center",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <IconX size={13} color="#ffffff" aria-hidden />
              </Box>
            ) : null}
          </Box>
        ))}

        {items.length < MAX_EVIDENCE && !disabled ? (
          <Box
            component="button"
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="Thêm ảnh"
            className="agri-press"
            style={{
              width: 76,
              height: 76,
              borderRadius: 8,
              border: "1px dashed var(--agri-primary-border)",
              background: "var(--agri-primary-soft)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <IconCamera size={20} color="var(--agri-primary)" aria-hidden />
            <Text fz={11.5} fw={600} c="var(--agri-primary)">
              Thêm ảnh
            </Text>
          </Box>
        ) : null}
      </Group>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(event) => {
          acceptFiles(event.currentTarget.files, items.length);
          // Allow picking the same file again (a retry after a rejection).
          event.currentTarget.value = "";
        }}
      />

      {items.some((i) => i.status === "error") ? (
        <Text fz={12.5} c="var(--agri-danger)" mt={8} style={{ lineHeight: "18px" }}>
          Có ảnh chưa tải lên được. Bấm Gửi để thử lại — ảnh đã tải xong sẽ không gửi lại.
        </Text>
      ) : null}

      {remaining > 0 && items.length > 0 ? (
        <Text fz={11.5} c="var(--agri-muted)" mt={6}>
          Còn có thể thêm {remaining} ảnh (JPG, PNG, WebP; mỗi ảnh tối đa 5 MB).
        </Text>
      ) : null}
    </Box>
  );
}
