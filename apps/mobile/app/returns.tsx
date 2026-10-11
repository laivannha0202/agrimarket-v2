/**
 * Trả hàng.
 *
 * NO TECHNICAL IDS
 *
 * The previous version asked the customer to type an `orderItemId`. Now the
 * screen lists what the backend says can still be returned
 * (`GET /returns/me/eligible-items`) and the id travels inside the request.
 *
 * The list is server-side and already accounts for what the customer has
 * claimed before: each row carries `returnableQuantity` = purchased minus
 * everything tied up in active requests. The quantity box is capped by that
 * number and the create call re-checks the same sum inside a transaction, so a
 * customer cannot promise the same unit twice.
 */

import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  EvidencePicker,
  uploadEvidence,
  type PickedEvidence,
} from "../src/components/EvidencePicker";
import { Badge, Card, EmptyView, ErrorView, LinkPress, LoadingView, PrimaryButton } from "../src/components/ui";
import { errorMessage, isNetworkError } from "../src/lib/api-client";
import { formatDateTime, formatQuantity } from "../src/lib/format";
import { resources } from "../src/lib/resources";
import { returnStatusMeta } from "../src/lib/status";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import { useAuth } from "../src/providers";

/** Parses a Decimal-as-string quantity, treating anything unusable as 0. */
function maxQuantity(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function ReturnsScreen() {
  const { token, hydrated } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { orderItemId: presetId } = useLocalSearchParams<{ orderItemId?: string }>();

  const [pickedId, setPickedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<PickedEvidence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const list = useQuery({
    queryKey: ["returns"],
    queryFn: () => resources.listMyReturns({ page: 1, limit: 20 }),
    enabled: hydrated && token !== null,
  });

  const eligible = useQuery({
    queryKey: ["returnable-items"],
    queryFn: () => resources.listReturnableItems({ page: 1, limit: 30 }),
    enabled: hydrated && token !== null,
  });

  /**
   * The selected line is DERIVED, not stored: `explicit tap ?? deep-link
   * parameter`. Storing it and syncing from an effect caused an extra render and
   * could leave a stale selection after the list refreshed. Deriving guarantees
   * the selection is always one of the rows actually on screen, and the
   * quantity cap always belongs to the row being shown.
   */
  const selected =
    eligible.data?.data.find((i) => i.orderItemId === pickedId) ??
    (presetId
      ? (eligible.data?.data.find((i) => i.orderItemId === Number(presetId)) ?? null)
      : null);

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Vui lòng chọn sản phẩm cần trả.");

      const requested = Number(quantity);
      const max = maxQuantity(selected.returnableQuantity);
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new Error("Số lượng trả phải lớn hơn 0.");
      }
      /**
       * Checked here for a fast, clear message; the backend enforces the same
       * bound against the live sum, so this cannot be used to over-claim.
       */
      if (requested > max) {
        throw new Error(`Bạn chỉ có thể trả tối đa ${max} cho sản phẩm này.`);
      }

      // Upload first: a failed photo means no request is created and the form
      // survives for a retry.
      const evidenceIds = await uploadEvidence(evidence, setEvidence, resources.uploadEvidence);

      return resources.createReturn({
        orderItemId: selected.orderItemId,
        quantity: requested,
        reason: reason.trim(),
        evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined,
      });
    },
    onSuccess: () => {
      setError(null);
      setDone(true);
      setPickedId(null);
      setReason("");
      setQuantity("1");
      setEvidence([]);
      void client.invalidateQueries({ queryKey: ["returns"] });
      void client.invalidateQueries({ queryKey: ["returnable-items"] });
    },
    onError: (err) => setError(errorMessage(err, "Gửi yêu cầu thất bại.")),
  });

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
          message="Đăng nhập để xem và tạo yêu cầu trả hàng."
          actionLabel="Đăng nhập"
          onAction={() => router.push({ pathname: "/login", params: { redirect: "/returns" } })}
          fill
        />
      </View>
    );
  }
  if (list.isPending || eligible.isPending) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải trả hàng…" />
      </View>
    );
  }
  if (list.isError || eligible.isError) {
    const err = list.error ?? eligible.error;
    return (
      <View style={styles.statePage}>
        <ErrorView
          message={errorMessage(err, "Không tải được trả hàng.")}
          onRetry={() => {
            void list.refetch();
            void eligible.refetch();
          }}
          network={isNetworkError(err)}
          fill
        />
      </View>
    );
  }

  const returns = list.data.data;
  const returnable = eligible.data.data;

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
        {done ? (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={17} color={colors.primary} />
            <Text style={styles.successText}>
              Đã gửi yêu cầu trả hàng. Theo dõi trạng thái ở danh sách bên dưới.
            </Text>
          </View>
        ) : null}

        <Text style={styles.section}>Yêu cầu đã gửi</Text>
        {returns.length === 0 ? (
          <EmptyView
            kind="orders"
            title="Chưa có yêu cầu trả hàng"
            message="Yêu cầu trả hàng chỉ áp dụng cho đơn đã giao. Tạo yêu cầu ở biểu mẫu bên dưới."
          />
        ) : (
          returns.map((r) => {
            const meta = returnStatusMeta(r.status);
            return (
              <LinkPress
                key={r.id}
                href={{ pathname: "/return/[id]", params: { id: String(r.id) } }}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityLabel={`Yêu cầu trả hàng ${r.id}`}
              >
                <View style={styles.head}>
                  <Text style={styles.code}>Yêu cầu #{r.id}</Text>
                  <Badge label={meta.label} tone={meta.tone} />
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="receipt-outline" size={14} color={colors.mutedSoft} />
                  <Text style={styles.muted}>Đơn {r.order?.code ?? `#${r.orderId}`}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="cube-outline" size={14} color={colors.mutedSoft} />
                  <Text style={styles.muted}>Số lượng {formatQuantity(r.quantity)}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="time-outline" size={14} color={colors.mutedSoft} />
                  <Text style={styles.muted}>{formatDateTime(r.createdAt)}</Text>
                </View>
                <Text style={styles.reason} numberOfLines={2}>
                  {r.reason}
                </Text>
              </LinkPress>
            );
          })
        )}

        <Card>
          <Text style={styles.section}>Tạo yêu cầu trả hàng</Text>

          {returnable.length === 0 ? (
            <Text style={styles.hint}>
              Bạn chưa có sản phẩm nào có thể trả. Chỉ đơn đã giao và còn số lượng chưa yêu cầu trả mới
              hiển thị ở đây.
            </Text>
          ) : (
            <>
              <Text style={styles.label}>Chọn sản phẩm cần trả</Text>
              {returnable.map((item) => {
                const active = selected?.orderItemId === item.orderItemId;
                return (
                  <Pressable
                    key={item.orderItemId}
                    onPress={() => {
                      setPickedId(item.orderItemId);
                      setQuantity("1");
                      setDone(false);
                      setError(null);
                    }}
                    style={[styles.item, active && styles.itemActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Chọn ${item.productName}`}
                  >
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.itemThumb} />
                    ) : (
                      <View style={[styles.itemThumb, styles.itemThumbFallback]}>
                        <Ionicons name="leaf-outline" size={18} color={colors.mutedSoft} />
                      </View>
                    )}
                    <View style={styles.itemBody}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {item.productName}
                      </Text>
                      <Text style={styles.itemMeta} numberOfLines={1}>
                        {item.variantName} · đã mua {formatQuantity(item.purchasedQuantity)}
                      </Text>
                      <Text style={styles.itemMeta}>
                        Có thể trả {formatQuantity(item.returnableQuantity)} · Đơn {item.orderCode}
                      </Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={20} color={colors.borderStrong} />
                    )}
                  </Pressable>
                );
              })}

              {selected ? (
                <>
                  <Text style={styles.label}>
                    Số lượng trả (tối đa {formatQuantity(selected.returnableQuantity)})
                  </Text>
                  <TextInput
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="decimal-pad"
                    placeholder="1"
                    placeholderTextColor={colors.mutedSoft}
                    style={styles.input}
                  />

                  <Text style={styles.label}>Lý do</Text>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Mô tả tình trạng sản phẩm nhận được"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, styles.inputMultiline]}
                    multiline
                  />

                  <EvidencePicker items={evidence} onChange={setEvidence} disabled={create.isPending} />
                </>
              ) : (
                <Text style={styles.hint}>Chọn một sản phẩm ở trên để tạo yêu cầu trả.</Text>
              )}
            </>
          )}

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={15} color={colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          {returnable.length > 0 ? (
            <PrimaryButton
              label={create.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
              onPress={() => create.mutate()}
              disabled={create.isPending || !selected || reason.trim().length === 0}
              loading={create.isPending}
              style={styles.submit}
            />
          ) : null}
        </Card>
        <View style={styles.bottomPad} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  statePage: { flex: 1, backgroundColor: colors.page, justifyContent: "center" },

  muted: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 18 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 3 },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.9 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  code: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textStrong },
  reason: { fontSize: 12.5, color: colors.text, marginTop: spacing.xs, fontStyle: "italic" },

  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  hint: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginBottom: spacing.sm },
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
  inputMultiline: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: "top" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  error: { flex: 1, fontSize: 13, color: colors.danger },
  submit: { marginTop: spacing.md },

  /** Success banner shown after the backend confirms the request exists. */
  successBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  successText: { flex: 1, fontSize: 12.5, color: colors.primary, lineHeight: 18, fontWeight: "600" },

  /** One selectable returnable item. */
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  itemActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  itemThumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.page },
  itemThumbFallback: { alignItems: "center", justifyContent: "center" },
  itemBody: { flex: 1 },
  itemName: { fontSize: 13.5, fontWeight: "600", color: colors.text, lineHeight: 18 },
  itemMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
