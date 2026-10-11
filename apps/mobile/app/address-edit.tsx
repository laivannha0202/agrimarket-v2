/**
 * Thêm / Sửa địa chỉ — màn riêng.
 *
 * This is its own route, not a form inside the address book. The customer
 * reaches it deliberately (tap "Thêm địa chỉ" or "Sửa"), and leaving is one
 * back gesture — no half-filled form sits in the middle of a list.
 *
 * The province is a fixed, read-only value: the storefront delivers inside
 * Hưng Yên only, so a picker with a single option would be a control that
 * cannot do anything. `WardPicker` owns that decision and the ward sheet.
 *
 * The API is the authority on the address: it resolves the official commune
 * name from the code, rejects a code that is unknown or belongs to another
 * province, and normalises the phone number. This screen only checks what it
 * can check without the catalogue, so a bad code still comes back as a server
 * error instead of being silently accepted.
 */

import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { WardPicker } from "../src/components/WardPicker";
import { Badge, BottomBar, ErrorView, LoadingView, PrimaryButton } from "../src/components/ui";
import { errorMessage } from "../src/lib/api-client";
import {
  EMPTY_ADDRESS_FORM,
  formatAddressLine,
  isLegacyForm,
  toAddressForm,
  toAddressPayload,
  validateAddressForm,
  type AddressForm,
} from "../src/lib/address";
import { resources } from "../src/lib/resources";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { useAuth } from "../src/providers";

export default function AddressEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = id ? Number(id) : null;
  const isEdit = editingId !== null && Number.isFinite(editingId);

  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();

  const [form, setForm] = useState<AddressForm>(EMPTY_ADDRESS_FORM);
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);

  /**
   * The province name that travels with a code-verified payload. It is only the
   * display text the backend overwrites from the catalogue; the code pair is
   * what actually decides the address.
   */
  const provinces = useQuery({
    queryKey: ["locations", "provinces"],
    queryFn: () => resources.listProvinces(),
    staleTime: 60 * 60_000,
  });

  /**
   * The address being edited. It is seeded ONCE per id: re-seeding on every
   * render would overwrite what the customer is typing with the stored row.
   */
  const existing = useQuery({
    queryKey: ["address", editingId],
    queryFn: async () => {
      const all = await resources.listAddresses();
      const found = all.find((a) => a.id === editingId);
      if (!found) throw new Error("Không tìm thấy địa chỉ.");
      return found;
    },
    enabled: hydrated && token !== null && isEdit,
  });

  if (existing.data && loadedId !== existing.data.id) {
    setLoadedId(existing.data.id);
    setForm(toAddressForm(existing.data));
    setIsDefault(existing.data.isDefault);
  }

  const save = useMutation({
    mutationFn: async () => {
      const invalid = validateAddressForm(form);
      if (invalid) throw new Error(invalid);
      const provinceName = provinces.data?.find((p) => p.code === form.provinceCode)?.fullName ?? "";
      const payload = { ...toAddressPayload(form, provinceName), isDefault };
      if (!isEdit) return resources.createAddress(payload);
      return resources.updateAddress(editingId, payload);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["addresses"] });
      void client.invalidateQueries({ queryKey: ["address", editingId] });
      router.back();
    },
    onError: (err) => setError(errorMessage(err, "Lưu địa chỉ thất bại.")),
  });

  if (!hydrated || (isEdit && existing.isPending)) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải…" />
      </View>
    );
  }
  if (isEdit && existing.isError) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(existing.error, "Không tải được địa chỉ.")}
          onRetry={() => void existing.refetch()}
          fill
        />
      </View>
    );
  }

  const legacy = isEdit && isLegacyForm(form);

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
        {legacy && existing.data ? (
          <View style={styles.legacyBox}>
            <Badge label="Địa chỉ cũ" tone="gray" />
            <Text style={styles.legacyText}>
              Địa chỉ này được lưu trước khi cập nhật danh mục: {formatAddressLine(existing.data)}.
              Giữ nguyên nếu bạn không muốn đổi, hoặc chọn xã/phường theo danh mục mới ở bên dưới.
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>Người nhận</Text>
        <TextInput
          value={form.recipientName}
          onChangeText={(v) => setForm((f) => ({ ...f, recipientName: v }))}
          style={styles.input}
          placeholder="Nguyễn Văn A"
          placeholderTextColor={colors.mutedSoft}
          accessibilityLabel="Người nhận"
          autoComplete="name"
        />

        <Text style={styles.label}>Điện thoại</Text>
        <TextInput
          value={form.phone}
          onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
          style={styles.input}
          keyboardType="phone-pad"
          placeholder="0912345678"
          placeholderTextColor={colors.mutedSoft}
          accessibilityLabel="Điện thoại"
          autoComplete="tel"
        />

        <WardPicker form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

        <Text style={styles.label}>Thôn / Tổ dân phố (tùy chọn)</Text>
        <TextInput
          value={form.village}
          onChangeText={(v) => setForm((f) => ({ ...f, village: v }))}
          style={styles.input}
          placeholder="Ví dụ: Thôn Đông"
          placeholderTextColor={colors.mutedSoft}
          accessibilityLabel="Thôn tổ dân phố"
        />

        <Text style={styles.label}>Địa chỉ chi tiết</Text>
        <TextInput
          value={form.detail}
          onChangeText={(v) => setForm((f) => ({ ...f, detail: v }))}
          style={styles.input}
          placeholder="Số nhà, đường"
          placeholderTextColor={colors.mutedSoft}
          accessibilityLabel="Địa chỉ chi tiết"
        />

        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>Đặt làm địa chỉ mặc định</Text>
            <Text style={styles.switchHint}>Dùng sẵn ở bước thanh toán.</Text>
          </View>
          <Switch
            value={isDefault}
            onValueChange={setIsDefault}
            trackColor={{ true: colors.primary, false: colors.borderStrong }}
            accessibilityLabel="Đặt làm địa chỉ mặc định"
          />
        </View>

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
          label={save.isPending ? "Đang lưu…" : isEdit ? "Lưu thay đổi" : "Lưu địa chỉ"}
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

  legacyBox: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  legacyText: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginTop: 2 },

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

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginTop: spacing.lg,
    minHeight: TOUCH,
  },
  switchText: { flex: 1 },
  switchLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  switchHint: { fontSize: 12.5, color: colors.muted, marginTop: 2 },

  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  error: { flex: 1, fontSize: 13, color: colors.danger },
  submit: { marginTop: 0 },
});
