/**
 * Truy xuất nguồn gốc (tab).
 *
 * Layout follows the UI Kit mockup: a soft illustration card, a single code
 * field with a clear button, a primary "Tra cứu" CTA, a secondary "Quét mã QR"
 * button, and a short numbered guide.
 *
 * The illustration is decorative only — it is never shown as evidence that a
 * trace lookup happened. Results always come from `GET /trace/:code`.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Card, LinkPress, PrimaryButton } from "../../src/components/ui";
import { designAssets } from "../../src/lib/design-assets";
import { colors, radius, spacing, TOUCH } from "../../src/lib/theme";
import { parseTraceCode } from "../../src/lib/trace-code";

const STEPS: { title: string; text: string }[] = [
  { title: "Nhập mã trên tem hoặc bao bì", text: "Mã in trên tem lô hàng, dạng TRC-000001-XXXX." },
  { title: "Hoặc quét mã QR trên sản phẩm", text: "Camera mở thẳng hồ sơ của lô hàng tương ứng." },
  { title: "Xem thông tin chi tiết", text: "Trang trại, mùa vụ, thu hoạch và kết quả kiểm định." },
];

export default function TraceTabScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed = parseTraceCode(code);
    if (!parsed) {
      setError("Mã truy xuất không hợp lệ. Mã có dạng TRC-000001-XXXX.");
      return;
    }
    setError(null);
    router.push({ pathname: "/trace/[code]", params: { code: parsed } });
  };

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Illustration card */}
        <View style={styles.hero}>
          <Image source={designAssets.traceScan} style={styles.heroArt} resizeMode="contain" />
          <Text style={styles.heroTitle}>Truy xuất nguồn gốc</Text>
          <Text style={styles.heroText}>
            Kiểm tra xuất xứ, mùa vụ và kết quả kiểm định của sản phẩm trước khi sử dụng.
          </Text>
        </View>

        {/* Code entry */}
        <View style={styles.inputRow}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={code}
            onChangeText={(v) => {
              setCode(v);
              setError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="TRC-000001-CACHU"
            placeholderTextColor={colors.mutedSoft}
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={submit}
            accessibilityLabel="Mã truy xuất"
          />
          {code.length > 0 ? (
            <Pressable
              onPress={() => {
                setCode("");
                setError(null);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Xoá mã"
            >
              <Ionicons name="close-circle" size={18} color={colors.mutedSoft} />
            </Pressable>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={15} color={colors.danger} />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        <PrimaryButton label="Tra cứu" onPress={submit} style={styles.primary} />
        {/* `LinkPress`, not `<Link asChild>`: Radix Slot drops the callback-form
            style (see the note on LinkPress) which flattened this button. */}
        <LinkPress href="/scan" style={({ pressed }) => [styles.scanBtn, pressed && styles.pressed]}>
          <Ionicons name="qr-code-outline" size={18} color={colors.primary} />
          <Text style={styles.scanText}>Quét mã QR</Text>
        </LinkPress>

        {/* Guide */}
        <Card style={styles.guideCard}>
          <Text style={styles.guideTitle}>Hướng dẫn nhanh</Text>
          {STEPS.map((s, idx) => (
            <View key={s.title} style={styles.step}>
              <View style={styles.stepIndex}>
                <Text style={styles.stepIndexText}>{idx + 1}</Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepText}>{s.text}</Text>
              </View>
            </View>
          ))}
        </Card>

        <View style={styles.noteRow}>
          <Ionicons name="information-circle-outline" size={16} color={colors.info} />
          <Text style={styles.noteText}>
            Hồ sơ truy xuất do AgriMarket cung cấp theo dữ liệu ghi nhận của đơn vị sản xuất. AgriMarket không tự xác minh ngoài thực địa.
          </Text>
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  pressed: { opacity: 0.85 },

  hero: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  heroArt: { width: 168, height: 116 },
  heroTitle: { fontSize: 18, fontWeight: "700", color: colors.textStrong, textAlign: "center" },
  heroText: { fontSize: 13, color: colors.muted, textAlign: "center", lineHeight: 19 },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH + 4,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 8, letterSpacing: 0.5 },

  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  error: { flex: 1, fontSize: 13, color: colors.danger },

  primary: { marginTop: spacing.md, minHeight: TOUCH + 4 },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderColor: colors.primary,
    borderWidth: 1.5,
    borderRadius: radius.sm,
    minHeight: TOUCH + 4,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  scanText: { color: colors.primary, fontWeight: "700", fontSize: 15 },

  guideCard: { marginTop: spacing.lg, gap: spacing.md },
  guideTitle: { fontSize: 15, fontWeight: "700", color: colors.textStrong },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepIndex: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderColor: colors.primary,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepIndexText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  stepBody: { flex: 1, gap: 1 },
  stepTitle: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: 19 },
  stepText: { fontSize: 12.5, color: colors.muted, lineHeight: 18 },

  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: spacing.md, paddingHorizontal: spacing.xs },
  noteText: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 17 },
});
