/**
 * Authenticated evidence photo viewer for the customer's own screens.
 *
 * WHY NOT `<Image source={{ uri: evidenceFileUrl(id) }} />`
 *
 * `GET /evidence/:id/file` authorises every read with the session bearer
 * token, and React Native's `Image` sends no `Authorization` header — so a
 * plain image URL arrives anonymous and is refused for everything except an
 * APPROVED review photo. The bytes are therefore fetched with the token (see
 * `fetchEvidenceImage`) and handed to `Image` as a `data:` URI.
 *
 * The gallery degrades per-photo: a missing/forbidden file renders a neutral
 * placeholder instead of breaking the whole card, because an image that was
 * swept, deleted, or belongs to another account is a real possibility and
 * must not look like a layout bug.
 */

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { buildUrl } from "../lib/api-client";
import { getToken } from "../lib/session";
import type { EvidenceImage } from "../lib/types";
import { colors, radius, spacing } from "../lib/theme";

/**
 * Fetches one evidence photo as a `data:` URI with the session attached.
 *
 * Returns `null` on any failure — the caller renders a placeholder.
 *
 * WHY XHR INSTEAD OF `res.blob()`: React Native's `Response.blob()`
 * implementation is not spec-compliant and warns on every call (the warning
 * shown in the Android logs came from here). The photo is small (already
 * server-resized), so the bytes are read as an `ArrayBuffer` through
 * `XMLHttpRequest` — which RN supports without the blob shim — and encoded to
 * base64 by hand, avoiding both `Blob` and Node's `Buffer` (not present in RN).
 */
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : BASE64_CHARS[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : BASE64_CHARS[b2 & 0x3f];
  }
  return out;
}

export async function fetchEvidenceImage(id: number): Promise<string | null> {
  try {
    const token = await getToken();
    const url = buildUrl(`/evidence/${id}/file`);
    return await new Promise<string | null>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.responseType = "arraybuffer";
      xhr.onerror = () => resolve(null);
      xhr.onabort = () => resolve(null);
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300 || !xhr.response) {
          resolve(null);
          return;
        }
        try {
          const mime =
            xhr.getResponseHeader("Content-Type")?.split(";")[0]?.trim() || "image/jpeg";
          resolve(`data:${mime};base64,${base64FromArrayBuffer(xhr.response as ArrayBuffer)}`);
        } catch {
          resolve(null);
        }
      };
      xhr.send();
    });
  } catch {
    return null;
  }
}

function EvidenceThumb({ id, size = 64 }: { id: number; size?: number }) {
  const [state, setState] = useState<{ uri: string | null; failed: boolean }>({
    uri: null,
    failed: false,
  });

  useEffect(() => {
    let alive = true;
    // State reset lives in the async continuation, not the effect body: the
    // effect only subscribes to the fetch, and the fetch resolves the state.
    void fetchEvidenceImage(id).then((dataUri) => {
      if (!alive) return;
      setState(dataUri ? { uri: dataUri, failed: false } : { uri: null, failed: true });
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const { uri, failed } = state;
  if (failed) {
    return (
      <View style={[styles.thumb, styles.thumbFallback, { width: size, height: size }]}>
        <Ionicons name="image-outline" size={Math.max(16, size / 3)} color={colors.mutedSoft} />
      </View>
    );
  }
  if (!uri) {
    return <View style={[styles.thumb, styles.thumbLoading, { width: size, height: size }]} />;
  }
  return (
    <Image
      source={{ uri }}
      style={[styles.thumb, { width: size, height: size }]}
      accessibilityLabel="Ảnh minh chứng"
      onError={() => setState({ uri: null, failed: true })}
    />
  );
}

export function EvidenceGallery({
  images,
  label = "Ảnh minh chứng đã gửi",
  size = 64,
}: {
  images: EvidenceImage[] | undefined;
  label?: string;
  size?: number;
}) {
  if (!images || images.length === 0) return null;
  return (
    <View>
      <Text style={styles.label}>
        {label} ({images.length})
      </Text>
      <View style={styles.row}>
        {images.map((img) => (
          <EvidenceThumb key={img.id} id={img.id} size={size} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12.5, color: colors.muted, marginTop: spacing.sm, marginBottom: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  thumb: {
    borderRadius: radius.sm,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.page,
  },
  thumbFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.page },
  thumbLoading: { backgroundColor: colors.border },
});
