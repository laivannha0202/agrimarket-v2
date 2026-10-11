/**
 * Đăng nhập.
 *
 * The account must already exist; this screen signs it in against
 * `POST /auth/login`. Self-registration, password recovery and password change
 * now have real backend routes, so each of them is a real link here instead of
 * a note saying the feature is missing.
 *
 * There is still no Google/Facebook sign-in: the mockup shows a Google button
 * but no OAuth endpoint exists behind it, so rendering one would be a dead
 * control that lies about what the app can do.
 *
 * The brand mark is the UI Kit leaf graphic (static `require`, see
 * `design-assets.ts`) — not a screenshot of the mockup.
 */

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { PrimaryButton } from "../src/components/ui";
import { errorMessage } from "../src/lib/api-client";
import { designAssets } from "../src/lib/design-assets";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { useAuth } from "../src/providers";

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const { redirect, email: prefilledEmail } = useLocalSearchParams<{ redirect?: string; email?: string }>();
  // `?email=` is how the register screen hands the address back, so the
  // customer does not retype it. It seeds the initial state directly rather
  // than being copied in by an effect: the register screen arrives with
  // `router.replace`, which mounts this screen fresh, so the initial value is
  // already correct on the first render and no cascading re-render is needed.
  const [email, setEmail] = useState(
    typeof prefilledEmail === "string" ? prefilledEmail.trim() : "",
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) {
      setError("Vui lòng nhập email và mật khẩu.");
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
      const target = typeof redirect === "string" && redirect.startsWith("/") ? redirect : "/(tabs)";
      router.replace(target as never);
    } catch (err) {
      setError(errorMessage(err, "Đăng nhập thất bại. Vui lòng thử lại."));
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
        <View style={styles.brand}>
          <Image source={designAssets.brandLeafMark} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brandName}>AgriMarket</Text>
          <Text style={styles.brandSub}>Nông sản sạch, rõ nguồn gốc</Text>
        </View>

        <View style={styles.form}>
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
              returnKeyType="next"
              accessibilityLabel="Email"
            />
          </View>

          <Text style={styles.label}>Mật khẩu</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
            <TextInput
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(null);
              }}
              secureTextEntry={!showPassword}
              placeholder="••••••"
              placeholderTextColor={colors.mutedSoft}
              style={styles.input}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              accessibilityLabel="Mật khẩu"
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            >
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={colors.mutedSoft} />
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label={busy ? "Đang đăng nhập…" : "Đăng nhập"}
            onPress={() => void submit()}
            disabled={busy}
            loading={busy}
            style={styles.submit}
          />

          <Pressable
            onPress={() => router.push("/forgot-password")}
            hitSlop={8}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.link}>Quên mật khẩu?</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push("/register")}
          style={({ pressed }) => [styles.registerBox, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Ionicons name="person-add-outline" size={16} color={colors.primary} />
          <Text style={styles.registerText}>Chưa có tài khoản? Đăng ký ngay</Text>
          <Ionicons name="chevron-forward" size={15} color={colors.primary} />
        </Pressable>

        {/* Capability disclosure — the mockup's Google button has no backend. */}
        <View style={styles.noteBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
          <Text style={styles.note}>
            Ứng dụng chưa hỗ trợ đăng nhập Google/Facebook. Tài khoản AgriMarket dùng chung cho ứng dụng
            và website.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.lg, paddingTop: spacing.xxl, flexGrow: 1 },
  brand: { alignItems: "center", gap: spacing.xs, marginBottom: spacing.xl },
  logo: { width: 76, height: 76 },
  brandName: { fontSize: 22, fontWeight: "700", color: colors.primary, marginTop: spacing.sm },
  brandSub: { fontSize: 13, color: colors.muted },

  form: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
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

  pressed: { opacity: 0.85 },
  linkRow: { alignItems: "flex-end", paddingVertical: spacing.sm },
  link: { fontSize: 13, fontWeight: "700", color: colors.primary },

  registerBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: TOUCH,
    marginTop: spacing.md,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  registerText: { fontSize: 13.5, fontWeight: "700", color: colors.primary },

  noteBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  note: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 17 },
});
