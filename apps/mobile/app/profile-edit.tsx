/**
 * Sửa hồ sơ — màn riêng.
 *
 * The edit form used to open INSIDE the Account tab: tapping "Sửa" expanded a
 * form in the middle of the menu, pushing the rest of the rows down and mixing
 * "browse my account" with "edit my data" in one scroll. Editing is now its own
 * screen, so the tab stays a hub and the form gets the whole viewport.
 *
 * The phone is validated by the backend (it normalises to a Vietnamese mobile
 * number). This screen only checks that the name is present, so an invalid
 * phone still comes back as a server error instead of being silently accepted.
 */

import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BottomBar, ErrorView, LoadingView, PrimaryButton } from "../src/components/ui";
import { errorMessage } from "../src/lib/api-client";
import { resources } from "../src/lib/resources";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { useAuth } from "../src/providers";

export default function ProfileEditScreen() {
  const { user, hydrated, refreshMe } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      if (!fullName.trim()) throw new Error("Vui lòng nhập họ tên.");
      return resources.updateMyProfile({ fullName: fullName.trim(), phone: phone.trim() || undefined });
    },
    onSuccess: async () => {
      setError(null);
      await refreshMe();
      router.back();
    },
    onError: (err) => setError(errorMessage(err, "Lưu thất bại.")),
  });

  if (!hydrated) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải…" />
      </View>
    );
  }
  if (!user) {
    return (
      <View style={styles.statePage}>
        <ErrorView message="Vui lòng đăng nhập để sửa hồ sơ." fill />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.label}>Họ tên</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          style={styles.input}
          placeholder="Nguyễn Văn A"
          placeholderTextColor={colors.mutedSoft}
          accessibilityLabel="Họ tên"
          autoComplete="name"
        />

        <Text style={styles.label}>Điện thoại</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          style={styles.input}
          placeholder="09xxxxxxxx"
          placeholderTextColor={colors.mutedSoft}
          accessibilityLabel="Điện thoại"
          autoComplete="tel"
        />

        {/**
         * The e-mail is shown but not editable: it identifies the account and is
         * the recovery address, so changing it would need a verification flow
         * that does not exist. Showing it read-only is more honest than hiding
         * it, which would look like an oversight.
         */}
        <Text style={styles.label}>Email</Text>
        <View style={styles.readonly}>
          <Ionicons name="mail-outline" size={16} color={colors.mutedSoft} />
          <Text style={styles.readonlyText} numberOfLines={1}>
            {user.email}
          </Text>
          <Ionicons name="lock-closed-outline" size={14} color={colors.mutedSoft} />
        </View>
        <Text style={styles.hint}>Email dùng để đăng nhập và khôi phục mật khẩu, không thể đổi tại đây.</Text>

        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={15} color={colors.danger} />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.bottomPad} />
      </ScrollView>

      <BottomBar>
        <PrimaryButton
          label={save.isPending ? "Đang lưu…" : "Lưu thay đổi"}
          onPress={() => save.mutate()}
          disabled={save.isPending}
          loading={save.isPending}
          style={styles.submit}
        />
      </BottomBar>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 4, marginTop: spacing.sm },
  input: {
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  readonly: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    backgroundColor: colors.page,
  },
  readonlyText: { flex: 1, fontSize: 14, color: colors.muted },
  hint: { fontSize: 12.5, color: colors.muted, marginTop: 4, lineHeight: 18 },

  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  error: { flex: 1, fontSize: 13, color: colors.danger },
  submit: { marginTop: 0 },
});
