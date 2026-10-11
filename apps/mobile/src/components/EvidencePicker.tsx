/**
 * Evidence photo picker — chọn tối đa 5 ảnh cho khiếu nại / trả hàng / đánh giá.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not upload on its own schedule and it does not report success. The
 * screen uploads when the customer presses "Gửi", waits for every file to come
 * back with an id, and only then calls the create endpoint with those ids. That
 * order is what makes the outcome honest: if an upload fails, no request is
 * created, the customer sees the failure, and the form keeps everything they
 * typed so they can retry.
 *
 * The alternative — uploading in the background as each photo is picked — would
 * mean holding ids for files the customer might then remove, and would make
 * "submit failed" ambiguous: some photos uploaded, some did not, and the
 * request was never created. Keeping the two steps adjacent removes that whole
 * class of half-state.
 *
 * WHY expo-image-picker
 *
 * It is the Expo-managed picker: no prebuild, no eject, no native module
 * configuration, so the app stays on Expo Go. `requestMediaLibraryPermissions`
 * is called at the moment of use rather than on mount, because a permission
 * prompt that appears before the customer has asked for anything is the usual
 * reason people deny it.
 */

import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radius, spacing, TOUCH } from "../lib/theme";

/** Max photos per request. Mirrors the backend cap. */
export const MAX_EVIDENCE = 5;

/**
 * One picked photo, before upload.
 *
 * `status` is what the UI shows: `pending` has not been tried, `uploading` is
 * in flight, `done` carries the server id, `error` can be retried. Keeping the
 * id here — rather than in a parallel array — means a photo and its uploaded id
 * can never drift apart when the customer removes one.
 */
export interface PickedEvidence {
  key: string;
  uri: string;
  fileName: string;
  mimeType: string;
  status: "pending" | "uploading" | "done" | "error";
  evidenceId?: number;
  error?: string;
}

export interface EvidencePickerProps {
  items: PickedEvidence[];
  onChange: (items: PickedEvidence[]) => void;
  disabled?: boolean;
  label?: string;
}

/**
 * Uploads every photo that still needs one and returns the ordered ids.
 *
 * Called by the screen at submit time. Photos that already uploaded are not
 * re-sent, so pressing "Gửi" again after a failure only retries what failed —
 * a second attempt cannot create duplicate images on the server.
 *
 * Throws with a customer-readable message if any upload fails; the caller is
 * responsible for keeping the form intact and showing that message.
 */
export async function uploadEvidence(
  items: PickedEvidence[],
  onProgress: (items: PickedEvidence[]) => void,
  upload: (file: { uri: string; name: string; type: string }) => Promise<{ id: number }>,
): Promise<number[]> {
  const working = [...items];
  const ids: number[] = [];

  for (let i = 0; i < working.length; i += 1) {
    const current = working[i]!;
    if (current.status === "done" && current.evidenceId !== undefined) {
      ids.push(current.evidenceId);
      continue;
    }

    working[i] = { ...current, status: "uploading", error: undefined };
    onProgress([...working]);

    try {
      const result = await upload({
        uri: current.uri,
        name: current.fileName,
        type: current.mimeType,
      });
      working[i] = { ...working[i]!, status: "done", evidenceId: result.id };
      ids.push(result.id);
      onProgress([...working]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tải ảnh thất bại.";
      working[i] = { ...working[i]!, status: "error", error: message };
      onProgress([...working]);
      throw new Error(message);
    }
  }

  return ids;
}

export function EvidencePicker({
  items,
  onChange,
  disabled,
  label = "Ảnh minh chứng",
}: EvidencePickerProps) {
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    if (items.length >= MAX_EVIDENCE) {
      Alert.alert("Đã đủ ảnh", `Mỗi yêu cầu gửi tối đa ${MAX_EVIDENCE} ảnh.`);
      return;
    }

    setBusy(true);
    try {
      /**
       * Permission first. A denial is a normal outcome, not an error: the
       * message explains what to do and offers the settings screen, because on
       * Android a denied permission cannot be re-requested from the app.
       */
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Cần quyền truy cập ảnh",
          "AgriMarket cần quyền đọc thư viện ảnh để bạn đính kèm ảnh minh chứng.",
          [
            { text: "Để sau", style: "cancel" },
            { text: "Mở cài đặt", onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }

      const remaining = MAX_EVIDENCE - items.length;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        // The image is re-encoded server-side, so asking the picker for full
        // quality only wastes the customer's data allowance.
        quality: 0.8,
      });
      if (result.canceled) return;

      /**
       * Extra selections beyond the remaining slots are dropped here rather
       * than at submit time, so the counter the customer sees is always the
       * truth about what will be sent.
       */
      const picked: PickedEvidence[] = result.assets.slice(0, remaining).map((asset, index) => {
        const name = asset.fileName ?? `anh-${Date.now()}-${index}.jpg`;
        return {
          key: `${Date.now()}-${index}-${asset.assetId ?? asset.uri}`,
          uri: asset.uri,
          fileName: name,
          mimeType: asset.mimeType ?? guessMime(name),
          status: "pending" as const,
        };
      });
      onChange([...items, ...picked]);
    } catch {
      Alert.alert("Không chọn được ảnh", "Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };

  const removeAt = (key: string) => onChange(items.filter((i) => i.key !== key));

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.counter}>
          {items.length}/{MAX_EVIDENCE}
        </Text>
      </View>

      <View style={styles.grid}>
        {items.map((item) => (
          <View key={item.key} style={styles.thumbWrap}>
            <Image source={{ uri: item.uri }} style={styles.thumb} accessibilityLabel="Ảnh đã chọn" />

            {item.status === "uploading" ? (
              <View style={styles.thumbOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : null}

            {item.status === "error" ? (
              <View style={[styles.thumbOverlay, styles.thumbError]}>
                <Ionicons name="alert-circle" size={18} color="#fff" />
              </View>
            ) : null}

            {!disabled ? (
              <Pressable
                onPress={() => removeAt(item.key)}
                style={styles.removeBtn}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Xóa ảnh"
              >
                <Ionicons name="close" size={13} color="#fff" />
              </Pressable>
            ) : null}
          </View>
        ))}

        {items.length < MAX_EVIDENCE && !disabled ? (
          <Pressable
            onPress={() => void pick()}
            disabled={busy}
            style={({ pressed }) => [
              styles.addTile,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Thêm ảnh"
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={20} color={colors.primary} />
                <Text style={styles.addText}>Thêm ảnh</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>

      {items.some((i) => i.status === "error") ? (
        <Text style={styles.errorHint}>
          Có ảnh chưa tải lên được. Bấm Gửi để thử lại — ảnh đã tải xong sẽ không gửi lại.
        </Text>
      ) : null}
    </View>
  );
}

/** Best-effort MIME from the file name; the server re-checks the real bytes. */
function guessMime(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginTop: spacing.sm },
  counter: { fontSize: 12.5, color: colors.muted, marginTop: spacing.sm },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  thumbWrap: { width: 76, height: 76 },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: radius.sm,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.page,
  },
  thumbOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.sm,
    backgroundColor: "rgba(15,18,15,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbError: { backgroundColor: "rgba(180,40,40,0.55)" },
  removeBtn: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.textStrong,
    alignItems: "center",
    justifyContent: "center",
  },

  addTile: {
    width: 76,
    height: 76,
    borderRadius: radius.sm,
    borderColor: colors.primaryBorder,
    borderWidth: 1,
    borderStyle: "dashed",
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minHeight: TOUCH,
  },
  addText: { fontSize: 11.5, fontWeight: "600", color: colors.primary },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
  errorHint: { fontSize: 12.5, color: colors.danger, marginTop: spacing.sm, lineHeight: 18 },
});

