/**
 * Quên mật khẩu — step 1: ask the backend to create a reset link.
 *
 * The response never reveals whether the address is registered — that is the
 * backend's anti-enumeration design (`AuthService.forgotPassword` returns the
 * same object on every path), and this screen must not undo it by, say,
 * reporting "email not found".
 *
 * `delivery.delivered` is surfaced honestly: when the API runs on the `test`
 * transport (no SMTP configured) no e-mail actually leaves the server, so the
 * screen says so instead of claiming a message was sent. That distinction is
 * the whole reason the field exists.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Card, GhostButton, PrimaryButton } from "../src/components/ui";
import { errorMessage } from "../src/lib/api-client";
import { resources } from "../src/lib/resources";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [realDelivery, setRealDelivery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!email.trim()) {
      setError("Vui lòng nhập email đăng nhập.");
      return;
    }
    setBusy(true);
    try {
      const result = await resources.forgotPassword(email.trim().toLowerCase());
      setSentTo(email.trim().toLowerCase());
      setRealDelivery(result.delivery.delivered);
    } catch (err) {
      setError(errorMessage(err, "Không gửi được yêu cầu. Vui lòng thử lại sau."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={styles.head}>
            <Ionicons name="mail-outline" size={20} color={colors.primary} />
            <Text style={styles.title}>Quên mật khẩu</Text>
          </View>
          <Text style={styles.intro}>
            Nhập email đăng nhập, hệ thống sẽ gửi liên kết đặt lại mật khẩu. Liên kết chỉ dùng được một
            lần và hết hạn sau 60 phút.
          </Text>

          {sentTo ? (
            <View style={[styles.notice, realDelivery ? styles.noticeOk : styles.noticeWarn]}>
              <Ionicons
                name={realDelivery ? "checkmark-circle" : "information-circle"}
                size={17}
                color={realDelivery ? colors.primary : colors.warning}
              />
              <View style={styles.noticeBody}>
                <Text style={styles.noticeTitle}>
                  {realDelivery ? "Đã gửi liên kết" : "Chưa cấu hình gửi email"}
                </Text>
                <Text style={styles.noticeText}>
                  Nếu email {sentTo} có tài khoản AgriMarket, một liên kết đặt lại mật khẩu đã được tạo.
                </Text>
                {realDelivery ? null : (
                  <Text style={styles.noticeText}>
                    Máy chủ hiện chưa cấu hình SMTP nên email chưa được gửi thật. Vui lòng liên hệ
                    AgriMarket để được hỗ trợ đặt lại mật khẩu.
                  </Text>
                )}
              </View>
            </View>
          ) : null}

          <Text style={styles.label}>Email</Text>
          <View style={styles.inputRow}>
            <Ionicons name="mail-outline" size={18} color={colors.muted} />
            <TextInput
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="khachhang@agrimarket.vn"
              placeholderTextColor={colors.mutedSoft}
              style={styles.input}
              accessibilityLabel="Email"
            />
          </View>

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label={busy ? "Đang gửi…" : "Gửi liên kết đặt lại"}
            onPress={() => void submit()}
            disabled={busy}
            loading={busy}
            style={styles.submit}
          />
        </Card>

        <Card>
          <Text style={styles.title}>Đã có liên kết trong email?</Text>
          <Text style={styles.intro}>
            Mở liên kết trong email để đặt mật khẩu mới. Nếu ứng dụng không tự mở, hãy dán mã trong
            liên kết vào ô bên dưới.
          </Text>
          <GhostButton
            label="Nhập mã đặt lại"
            icon="key-outline"
            onPress={() => router.push("/reset-password")}
            style={styles.secondary}
          />
        </Card>

        <Pressable
          onPress={() => router.replace("/login")}
          style={({ pressed }) => [styles.footer, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.footerText}>Quay lại đăng nhập</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md, flexGrow: 1 },
  pressed: { opacity: 0.85 },

  head: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  title: { fontSize: 16, fontWeight: "700", color: colors.textStrong },
  intro: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: spacing.sm },

  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6, marginTop: spacing.sm },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 8 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  error: { flex: 1, fontSize: 13, color: colors.danger, lineHeight: 18 },
  submit: { marginTop: spacing.lg },
  secondary: { marginTop: spacing.sm },

  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  noticeOk: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
  noticeWarn: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  noticeBody: { flex: 1, gap: 2 },
  noticeTitle: { fontSize: 13.5, fontWeight: "700", color: colors.textStrong },
  noticeText: { fontSize: 12.5, color: colors.muted, lineHeight: 18 },

  footer: { alignItems: "center", paddingVertical: spacing.lg },
  footerText: { fontSize: 13, fontWeight: "700", color: colors.primary },
});
