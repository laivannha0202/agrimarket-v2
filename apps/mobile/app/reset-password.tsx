/**
 * Đặt lại mật khẩu — step 2: redeem the single-use token.
 *
 * The raw token is the ONLY thing that proves the request came from the mailbox
 * owner, so it is sent straight to `POST /auth/reset-password` and never stored.
 * The backend decides whether it is still valid (unused, unexpired) and answers
 * the same "invalid or expired" error for every failure mode.
 *
 * The token can arrive two ways:
 *   - a deep link (`agrimarket://reset-password?token=…`), or
 *   - typed/pasted from the e-mail, which is the reliable path in Expo Go —
 *     a custom scheme cannot be registered by the Go client, so the customer
 *     must be able to enter the code by hand instead of hitting a dead end.
 *
 * No session is issued: the customer signs in with the new password, the same
 * single flow used after registration.
 */

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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

/** The reset link is `<web>/dat-lai-mat-khau?token=…`; accept a pasted URL too. */
function extractToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const marker = "token=";
  const at = trimmed.indexOf(marker);
  if (at === -1) return trimmed;
  const rest = trimmed.slice(at + marker.length);
  const end = rest.search(/[&\s]/);
  const raw = end === -1 ? rest : rest.slice(0, end);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(() => extractToken(params.token ?? ""));
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);

    if (!token.trim()) {
      setError("Vui lòng dán mã đặt lại trong liên kết email.");
      return;
    }
    if (password.length < 10) {
      setError("Mật khẩu phải có ít nhất 10 ký tự.");
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).+$/.test(password)) {
      setError("Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Mật khẩu nhập lại chưa khớp.");
      return;
    }

    setBusy(true);
    try {
      await resources.resetPassword(token.trim(), password);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, "Không đặt lại được mật khẩu. Vui lòng thử lại."));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={styles.donePage}>
        <Ionicons name="checkmark-circle" size={54} color={colors.primary} />
        <Text style={styles.doneTitle}>Đã đặt lại mật khẩu</Text>
        <Text style={styles.doneText}>Mật khẩu mới đã được lưu. Vui lòng đăng nhập lại.</Text>
        <PrimaryButton label="Đăng nhập" onPress={() => router.replace("/login")} style={styles.doneCta} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={styles.head}>
            <Ionicons name="key-outline" size={20} color={colors.primary} />
            <Text style={styles.title}>Đặt lại mật khẩu</Text>
          </View>
          <Text style={styles.intro}>
            Dán mã trong liên kết đặt lại (hoặc mở liên kết từ email) rồi đặt mật khẩu mới.
          </Text>

          <Text style={styles.label}>Mã đặt lại</Text>
          <View style={styles.inputRow}>
            <Ionicons name="link-outline" size={18} color={colors.muted} />
            <TextInput
              value={token}
              onChangeText={(v) => {
                setToken(v);
                setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Dán mã trong email"
              placeholderTextColor={colors.mutedSoft}
              style={styles.input}
              accessibilityLabel="Mã đặt lại"
            />
          </View>

          <Text style={styles.label}>Mật khẩu mới</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
            <TextInput
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(null);
              }}
              secureTextEntry={!showPassword}
              placeholder="••••••••••"
              placeholderTextColor={colors.mutedSoft}
              style={styles.input}
              accessibilityLabel="Mật khẩu mới"
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={18}
                color={colors.mutedSoft}
              />
            </Pressable>
          </View>
          <Text style={styles.hint}>Tối thiểu 10 ký tự, có ít nhất 1 chữ cái và 1 chữ số.</Text>

          <Text style={styles.label}>Nhập lại mật khẩu mới</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
            <TextInput
              value={confirmPassword}
              onChangeText={(v) => {
                setConfirmPassword(v);
                setError(null);
              }}
              secureTextEntry={!showPassword}
              placeholder="••••••••••"
              placeholderTextColor={colors.mutedSoft}
              style={styles.input}
              accessibilityLabel="Nhập lại mật khẩu mới"
            />
          </View>

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label={busy ? "Đang lưu…" : "Đặt lại mật khẩu"}
            onPress={() => void submit()}
            disabled={busy}
            loading={busy}
            style={styles.submit}
          />
          <GhostButton
            label="Yêu cầu liên kết mới"
            onPress={() => router.replace("/forgot-password")}
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
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  error: { flex: 1, fontSize: 13, color: colors.danger, lineHeight: 18 },
  submit: { marginTop: spacing.lg },
  secondary: { marginTop: spacing.sm },

  footer: { alignItems: "center", paddingVertical: spacing.lg },
  footerText: { fontSize: 13, fontWeight: "700", color: colors.primary },

  donePage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    backgroundColor: colors.page,
    gap: spacing.sm,
  },
  doneTitle: { fontSize: 19, fontWeight: "700", color: colors.textStrong },
  doneText: { fontSize: 13.5, color: colors.muted, textAlign: "center", lineHeight: 19 },
  doneCta: { alignSelf: "stretch", marginTop: spacing.sm },
});
