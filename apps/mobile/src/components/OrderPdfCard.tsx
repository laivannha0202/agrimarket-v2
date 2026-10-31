/**
 * Order document card (Mobile).
 *
 * The backend renders the PDF; this card downloads those exact bytes with the
 * session bearer token and hands the file to the platform:
 *
 *  - native (Expo Go / dev build): `expo-file-system` writes the file into the
 *    app cache, then `expo-sharing` opens the system share sheet. The sheet is
 *    where Android offers PDF viewers and iOS offers "Open in…"/"Save to
 *    Files" — Expo Go has no embedded PDF viewer, so this is the platform-
 *    correct way to "open" a document without adding a native module that
 *    Expo Go cannot load.
 *  - web: the same authenticated bytes become a blob URL and open in a tab
 *    (or download), because `expo-sharing` has no web implementation.
 *
 * The token is sent as an `Authorization` header and never put in the URL or a
 * log. The file is validated by its `%PDF-` magic before it is shared, so an
 * HTML/JSON error page saved by the downloader is never presented as a
 * document. Ownership is enforced by the API: a CUSTOMER token can only read
 * its own order, and another customer's id answers 404.
 */

import { Ionicons } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError, buildUrl, errorMessage } from "../lib/api-client";
import { getToken } from "../lib/session";
import { colors, radius, spacing, TOUCH } from "../lib/theme";
import { Card } from "./ui";

type Mode = "open" | "save";
type Busy = null | Mode;

async function fetchPdfBlobUrl(orderId: number): Promise<string> {
  const token = await getToken();
  if (!token) throw new ApiError(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  const res = await fetch(buildUrl(`/orders/${orderId}/pdf`), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ApiError(res.status, "Không tải được phiếu đơn hàng.");
  }
  return URL.createObjectURL(await res.blob());
}

export function OrderPdfCard({ orderId, orderCode }: { orderId: number; orderCode: string }) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (mode: Mode) => {
    setBusy(mode);
    setError(null);
    try {
      if (Platform.OS === "web") {
        const href = await fetchPdfBlobUrl(orderId);
        if (mode === "open") {
          window.open(href, "_blank", "noopener,noreferrer");
        } else {
          const a = document.createElement("a");
          a.href = href;
          a.download = `agrimarket-order-${orderCode}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
        return;
      }

      const token = await getToken();
      if (!token) {
        throw new ApiError(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }
      const target = new File(Paths.cache, `agrimarket-order-${orderId}.pdf`);
      const file = await File.downloadFileAsync(buildUrl(`/orders/${orderId}/pdf`), target, {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
      });

      // A 4xx/5xx body can still be written to disk by some downloaders.
      // Validate the magic bytes before handing the file to the share sheet.
      const head = new TextDecoder().decode((await file.arrayBuffer()).slice(0, 5));
      if (head !== "%PDF-") {
        throw new Error("Máy chủ không trả về tệp PDF hợp lệ.");
      }

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error("Thiết bị này không hỗ trợ chia sẻ tệp.");
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
        dialogTitle:
          mode === "open" ? `Mở phiếu đơn ${orderCode}` : `Lưu / chia sẻ phiếu đơn ${orderCode}`,
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : errorMessage(err, "Không mở được phiếu đơn hàng. Vui lòng thử lại."),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <Text style={styles.section}>Phiếu đơn hàng</Text>
      <Text style={styles.hint}>
        Phiếu PDF do hệ thống tạo từ đơn này. Trên điện thoại, hệ thống mở bảng chia sẻ để
        bạn chọn ứng dụng xem hoặc lưu tệp.
      </Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => void run("open")}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={`Mở phiếu đơn ${orderCode}`}
          style={({ pressed }) => [
            styles.button,
            styles.primary,
            (pressed || busy === "open") && styles.pressed,
          ]}
        >
          <Ionicons name="document-text-outline" size={16} color="#fff" />
          <Text style={styles.primaryText}>
            {busy === "open" ? "Đang mở…" : "Mở phiếu PDF"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void run("save")}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={`Lưu hoặc chia sẻ phiếu đơn ${orderCode}`}
          style={({ pressed }) => [
            styles.button,
            styles.secondary,
            (pressed || busy === "save") && styles.pressed,
          ]}
        >
          <Ionicons name="share-outline" size={16} color={colors.primary} />
          <Text style={styles.secondaryText}>
            {busy === "save" ? "Đang chuẩn bị…" : "Lưu / chia sẻ"}
          </Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textStrong,
    marginBottom: spacing.xs,
  },
  hint: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  button: {
    minHeight: TOUCH,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexGrow: 1,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.surface,
  },
  primaryText: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "600",
  },
  secondaryText: {
    color: colors.primary,
    fontSize: 13.5,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
  },
  error: {
    marginTop: spacing.sm,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.danger,
  },
});
