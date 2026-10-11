/**
 * Sổ địa chỉ — danh sách.
 *
 * This screen is a LIST and nothing else. Creating and editing moved to
 * `/address-edit`, because the previous version rendered the whole form inline
 * under the list: opening the address book dropped the customer into a long
 * form they had not asked for, and the list scrolled away behind it.
 *
 * TWO GENERATIONS OF ADDRESS
 *
 * A new address is picked from the verified catalogue (tỉnh/thành phố →
 * xã/phường, no district — the 2025 two-level model). An address saved before
 * the reorganisation keeps its own free text: it is shown and can still be
 * edited, and the moment the customer picks a catalogue commune it becomes a
 * code-verified address. Nothing is guessed: the backend resolves the official
 * name from the code, and a code that is unknown or belongs to another province
 * is refused server-side.
 */

import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Card, EmptyView, ErrorView, LoadingView, PrimaryButton } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatAddressLine } from "../src/lib/address";
import { resources } from "../src/lib/resources";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { useAuth } from "../src/providers";

export default function AddressesScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["addresses"],
    queryFn: () => resources.listAddresses(),
    enabled: hydrated && token !== null,
  });

  const refresh = () => void client.invalidateQueries({ queryKey: ["addresses"] });

  const remove = useMutation({
    mutationFn: (id: number) => resources.deleteAddress(id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(errorMessage(err, "Xóa địa chỉ thất bại.")),
  });

  const setDefault = useMutation({
    mutationFn: (id: number) => resources.setDefaultAddress(id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(errorMessage(err, "Đặt mặc định thất bại.")),
  });

  /**
   * Deleting is confirmed, because the backend deletes the row outright and
   * there is no undo. Setting a default is NOT confirmed — it is one tap to
   * reverse by choosing another address, so a dialog would be noise.
   */
  const confirmRemove = (id: number, label: string) => {
    Alert.alert("Xóa địa chỉ", `Xóa địa chỉ của ${label}? Thao tác này không thể hoàn tác.`, [
      { text: "Hủy", style: "cancel" },
      { text: "Xóa", style: "destructive", onPress: () => remove.mutate(id) },
    ]);
  };


  if (!hydrated) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải…" />
      </View>
    );
  }
  if (!token) {
    return (
      <View style={styles.statePage}>
        <EmptyView
          kind="orders"
          title="Chưa đăng nhập"
          message="Đăng nhập để quản lý sổ địa chỉ giao hàng."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/addresses" } })}
          fill
        />
      </View>
    );
  }
  if (list.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải địa chỉ…" />
      </View>
    );
  }
  if (list.isError) {
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(list.error, "Không tải được địa chỉ.")}
          onRetry={() => void list.refetch()}
          network={isNetworkError(list.error)}
          fill
        />
      </View>
    );
  }

  const addressList = list.data ?? [];

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={15} color={colors.danger} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}

      {addressList.length === 0 ? (
        <EmptyView
          kind="orders"
          title="Chưa có địa chỉ"
          message="Thêm địa chỉ giao hàng để đặt hàng nhanh hơn."
        />
      ) : (
        addressList.map((a) => (
          <Card key={a.id}>
            <View style={styles.addrHead}>
              <Ionicons name="person-outline" size={15} color={colors.mutedSoft} />
              <Text style={styles.name} numberOfLines={1}>
                {a.recipientName} · {a.phone}
              </Text>
              {a.isDefault ? <Badge label="Mặc định" tone="green" /> : null}
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={15} color={colors.mutedSoft} />
              <Text style={styles.muted}>{formatAddressLine(a)}</Text>
            </View>
            {a.wardCode ? null : (
              <View style={styles.legacyRow}>
                <Badge label="Địa chỉ cũ" tone="gray" />
                <Text style={styles.legacyText}>
                  Chưa theo danh mục xã/phường 2025. Sửa và chọn lại xã/phường để dùng địa chỉ đã xác
                  minh.
                </Text>
              </View>
            )}
            <View style={styles.row}>
              <Pressable
                style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
                onPress={() =>
                  router.push({ pathname: "/address-edit", params: { id: String(a.id) } })
                }
                accessibilityRole="button"
                accessibilityLabel={`Sửa địa chỉ của ${a.recipientName}`}
              >
                <Ionicons name="create-outline" size={15} color={colors.text} />
                <Text style={styles.ghostText}>Sửa</Text>
              </Pressable>
              {!a.isDefault ? (
                <Pressable
                  style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
                  onPress={() => setDefault.mutate(a.id)}
                  disabled={setDefault.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`Đặt địa chỉ của ${a.recipientName} làm mặc định`}
                >
                  <Ionicons name="checkmark-circle-outline" size={15} color={colors.text} />
                  <Text style={styles.ghostText}>Mặc định</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
                onPress={() => confirmRemove(a.id, a.recipientName)}
                disabled={remove.isPending}
                accessibilityRole="button"
                accessibilityLabel={`Xóa địa chỉ của ${a.recipientName}`}
              >
                <Ionicons name="trash-outline" size={15} color={colors.danger} />
                <Text style={styles.dangerText}>Xóa</Text>
              </Pressable>
            </View>
          </Card>
        ))
      )}

      <PrimaryButton
        label="Thêm địa chỉ"
        icon="add"
        onPress={() => router.push("/address-edit")}
        style={styles.addBtn}
      />
      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  muted: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 18 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 },
  addrHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textStrong },

  legacyRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: spacing.sm },
  legacyText: { flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 },

  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  ghost: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    minHeight: TOUCH,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  ghostText: { color: colors.text, fontWeight: "600", fontSize: 13 },
  dangerText: { color: colors.danger, fontWeight: "600", fontSize: 13 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  error: { flex: 1, fontSize: 13, color: colors.danger },
  addBtn: { marginTop: spacing.md },
});
