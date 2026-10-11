/**
 * Quét mã QR truy xuất.
 *
 * The camera is used for exactly one thing: reading the trace code off a lot
 * label. Two deliberate behaviours:
 * - A scanned QR that is not a trace code is reported as such and scanning is
 *   paused, instead of looping on a foreign code and looking broken.
 * - "Nhập mã thủ công" is always available, so a customer who denies the
 *   camera permission can still reach the trace feature (a permission screen
 *   with no way forward is a dead end).
 *
 * The illustration on the permission screen is decorative guidance, never
 * evidence that a scan happened.
 */

import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { GhostButton, PrimaryButton } from "../src/components/ui";
import { designAssets } from "../src/lib/design-assets";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { parseTraceCode } from "../src/lib/trace-code";

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const goManual = () => router.replace("/(tabs)/trace");

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Đang kiểm tra quyền camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Image source={designAssets.traceScan} style={styles.permissionArt} resizeMode="contain" />
        <Text style={styles.title}>Cần quyền camera</Text>
        <Text style={styles.muted}>
          AgriMarket dùng camera chỉ để quét mã QR truy xuất trên tem lô hàng. Ứng dụng không lưu hay gửi hình ảnh
          camera đi đâu.
        </Text>
        <PrimaryButton label="Cấp quyền camera" onPress={requestPermission} style={styles.cta} />
        <GhostButton label="Nhập mã thủ công" icon="keypad-outline" onPress={goManual} style={styles.cta} />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={(result) => {
            if (scanned) return;
            const code = parseTraceCode(result.data);
            if (!code) {
              setError("Mã QR này không chứa mã truy xuất hợp lệ. Vui lòng thử mã khác.");
              setScanned(true);
              return;
            }
            setError(null);
            setScanned(true);
            router.replace({ pathname: "/trace/[code]", params: { code } });
          }}
        />
        {/* Scan frame overlay */}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.frame} />
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.hintRow}>
          <Ionicons name="qr-code-outline" size={18} color={colors.primary} />
          <Text style={styles.hintText}>Hướng camera vào mã QR trên tem lô hàng.</Text>
        </View>
        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={15} color={colors.danger} />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        {scanned ? (
          <PrimaryButton
            label="Quét lại"
            icon="scan-outline"
            onPress={() => {
              setScanned(false);
              setError(null);
            }}
          />
        ) : null}
        <GhostButton label="Nhập mã thủ công" icon="keypad-outline" onPress={goManual} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.textStrong },
  cameraWrap: { flex: 1, overflow: "hidden" },
  overlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  frame: {
    width: 220,
    height: 220,
    borderColor: "#fff",
    borderWidth: 3,
    borderRadius: radius.md,
    backgroundColor: "transparent",
  },
  footer: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hintText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },
  errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  error: { flex: 1, fontSize: 13, color: colors.danger, lineHeight: 18 },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    backgroundColor: colors.page,
    gap: spacing.sm,
  },
  permissionArt: { width: 172, height: 120, marginBottom: spacing.xs },
  title: { fontSize: 17, fontWeight: "700", color: colors.textStrong },
  muted: { fontSize: 13, color: colors.muted, textAlign: "center", lineHeight: 19 },
  cta: { alignSelf: "stretch", minHeight: TOUCH },
});
