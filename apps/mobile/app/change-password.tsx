/**
 * Đổi mật khẩu (đã đăng nhập).
 *
 * Calls `PATCH /auth/change-password`, which re-verifies the current password
 * server-side — a stolen token alone is not enough to lock the owner out — and
 * stamps `passwordChangedAt`, invalidating every token issued earlier. The API
 * answers with a fresh token so THIS device stays signed in while any other
 * device is signed out; `adoptToken` stores it.
 *
 * The other-devices-signed-out consequence is stated on screen: it is the
 * visible effect of the invalidation, not an incidental detail.
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
import { useAuth } from "../src/providers";

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { token, adoptToken } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);

    if (!currentPassword) {
      setError("Vui lòng nhập mật khẩu hiện tại.");
      return;
    }
    if (password.length < 10) {
      setError("Mật khẩu mới phải có ít nhất 10 ký tự.");
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).+$/.test(password)) {
      setError("Mật khẩu mới phải có ít nhất 1 chữ cái và 1 chữ số.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Mật khẩu nhập lại chưa khớp.");
      return;
    }
    if (password === currentPassword) {
      setError("Mật khẩu mới phải khác mật khẩu hiện tại.");
      return;
    }

    setBusy(true);
    try {
      const result = await resources.changePassword(currentPassword, password);
      // The old token is dead server-side; keep this device signed in.
      await adoptToken(result.accessToken);
      setCurrentPassword("");
      setPassword("");
      setConfirmPassword("");
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, "Không đổi được mật khẩu. Vui lòng thử lại."));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <View style={styles.donePage}>
        <Ionicons name="lock-closed-outline" size={50} color={colors.mutedSoft} />
        <Text style={styles.doneTitle}>Chưa đăng nhập</Text>
        <Text style={styles.doneText}>Đăng nhập để đổi mật khẩu tài khoản của bạn.</Text>
        <PrimaryButton
          label="Đăng nhập"
          onPress={() => router.push({ pathname: "/login", params: { redirect: "/change-password" } })}
          style={styles.doneCta}
        />
      </View>
    );
  }

  if (saved) {
    return (
      <View style={styles.donePage}>
        <Ionicons name="checkmark-circle" size={54} color={colors.primary} />
        <Text style={styles.doneTitle}>Đã đổi mật khẩu</Text>
        <Text style={styles.doneText}>
          Mật khẩu mới đã được lưu. Các thiết bị khác đang đăng nhập sẽ phải đăng nhập lại.
        </Text>
        <PrimaryButton label="Về tài khoản" onPress={() => router.replace("/(tabs)/account")} style={styles.doneCta} />
        <GhostButton
          label="Đổi lần nữa"
          onPress={() => {
            setSaved(false);
            setError(null);
          }}
          style={styles.doneCta}
        />
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
            <Text style={styles.title}>Đổi mật khẩu</Text>
          </View>
          <Text style={styles.intro}>
            Mật khẩu mới tối thiểu 10 ký tự, có ít nhất 1 chữ cái và 1 chữ số và phải khác mật khẩu
            hiện tại. Sau khi đổi, các thiết bị khác sẽ phải đăng nhập lại.
          </Text>

          <Text style={styles.label}>Mật khẩu hiện tại</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
            <TextInput
              value={currentPassword}
              onChangeText={(v) => {
                setCurrentPassword(v);
                setError(null);
              }}
              secureTextEntry={!showPassword}
              placeholder="Nhập mật khẩu đang dùng"
              placeholderTextColor={colors.mutedSoft}
              style={styles.input}
              accessibilityLabel="Mật khẩu hiện tại"
            />
          </View>

          <Text style={styles.label}>Mật khẩu mới</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-open-outline" size={18} color={colors.muted} />
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

          <Text style={styles.label}>Nhập lại mật khẩu mới</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-open-outline" size={18} color={colors.muted} />
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
            label={busy ? "Đang lưu…" : "Đổi mật khẩu"}
            onPress={() => void submit()}
            disabled={busy}
            loading={busy}
            style={styles.submit}
          />
        </Card>

        <Pressable
          onPress={() => router.replace("/forgot-password")}
          style={({ pressed }) => [styles.footer, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.footerText}>Quên mật khẩu hiện tại?</Text>
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
