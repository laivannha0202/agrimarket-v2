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
 * WHY expo-image-picker (+ expo-image-manipulator)
 *
 * Both are Expo-managed modules: no prebuild, no eject, no native-module
 * configuration, so the app stays on Expo Go. Permissions are requested at the
 * moment of use rather than on mount, because a permission prompt that appears
 * before the customer has asked for anything is the usual reason people deny
 * it. `expo-image-manipulator` resizes photos to 1600px / JPEG 0.8 before
 * upload so a 12 MP phone photo does not burn the customer's data allowance —
 * the server still re-validates magic bytes, size and dimensions and
 * re-encodes, so client compression is an optimisation, never a trust decision.
 */

import { Ionicons } from "@expo/vector-icons";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
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
import {
  EVIDENCE_MAX_SIDE_PX,
  MAX_EVIDENCE,
  MAX_EVIDENCE_BYTES,
  buildEvidenceFileName,
  isConvertibleEvidence,
  isSupportedEvidence,
  needsCompression,
  rejectReasonForAsset,
} from "../lib/evidence";
import { colors, radius, spacing, TOUCH } from "../lib/theme";

export { MAX_EVIDENCE };

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

/**
 * Resize / convert one picked asset with expo-image-manipulator.
 *
 * Returns the file to upload, or `null` when the image cannot be salvaged
 * (manipulator unavailable AND conversion required). Any other failure falls
 * back to the original: the server is the authority and will reject a truly
 * bad file with its own message at submit time.
 */
async function prepareAssetFile(asset: {
  uri: string;
  width?: number;
  height?: number;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}): Promise<{ uri: string; mimeType: string; width?: number; height?: number } | null> {
  const originalName = asset.fileName ?? "anh.jpg";
  const originalMime = asset.mimeType ?? "image/jpeg";
  const mustConvert = isConvertibleEvidence(originalName, asset.mimeType ?? undefined);
  const tooBig =
    typeof asset.fileSize === "number" && asset.fileSize > MAX_EVIDENCE_BYTES;
  const tooLarge = needsCompression(asset.width, asset.height);

  if (!mustConvert && !tooBig && !tooLarge && isSupportedEvidence(originalName, asset.mimeType ?? undefined)) {
    return { uri: asset.uri, mimeType: originalMime, width: asset.width, height: asset.height };
  }

  try {
    const ctx = ImageManipulator.manipulate(asset.uri);
    if (tooLarge || mustConvert || tooBig) {
      const w = asset.width ?? 0;
      const h = asset.height ?? 0;
      if (w > 0 && h > 0 && (w > EVIDENCE_MAX_SIDE_PX || h > EVIDENCE_MAX_SIDE_PX)) {
        if (w >= h) ctx.resize({ width: EVIDENCE_MAX_SIDE_PX });
        else ctx.resize({ height: EVIDENCE_MAX_SIDE_PX });
      }
    }
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    return { uri: out.uri, mimeType: "image/jpeg", width: out.width, height: out.height };
  } catch {
    // HEIC cannot go to the server unconverted (sharp may not decode it), so a
    // failed conversion is a real rejection, not a fallback.
    if (mustConvert) return null;
    if (isSupportedEvidence(originalName, asset.mimeType ?? undefined)) {
      return { uri: asset.uri, mimeType: originalMime, width: asset.width, height: asset.height };
    }
    return null;
  }
}

function settingsAlert(title: string, message: string): void {
  Alert.alert(title, message, [
    { text: "Để sau", style: "cancel" },
    { text: "Mở cài đặt", onPress: () => void Linking.openSettings() },
  ]);
}

export function EvidencePicker({
  items,
  onChange,
  disabled,
  label = "Ảnh minh chứng",
}: EvidencePickerProps) {
  const [busy, setBusy] = useState(false);

  /**
   * Turns raw picker assets into `PickedEvidence`, compressing each one.
   * Unsupported files are skipped and reported in ONE alert (not one per
   * file), so picking 5 files with 1 bad GIF does not bury the 4 good ones.
   */
  const acceptAssets = async (
    assets: ImagePicker.ImagePickerAsset[],
    startIndex: number,
  ): Promise<void> => {
    const skipped: string[] = [];
    const picked: PickedEvidence[] = [];

    for (let i = 0; i < assets.length; i += 1) {
      const asset = assets[i]!;
      const rejected = rejectReasonForAsset({
        fileName: asset.fileName ?? undefined,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
      if (rejected) {
        skipped.push(asset.fileName ?? `ảnh ${startIndex + i + 1}`);
        continue;
      }
      const prepared = await prepareAssetFile(asset);
      if (!prepared) {
        skipped.push(asset.fileName ?? `ảnh ${startIndex + i + 1}`);
        continue;
      }
      const fileName = buildEvidenceFileName(asset.fileName ?? undefined, prepared.mimeType, startIndex + i);
      picked.push({
        key: `${Date.now()}-${startIndex + i}-${asset.assetId ?? asset.uri}`,
        uri: prepared.uri,
        fileName,
        mimeType: prepared.mimeType,
        status: "pending" as const,
      });
    }

    if (picked.length > 0) onChange([...items, ...picked]);
    if (skipped.length > 0) {
      Alert.alert(
        "Một số ảnh không thêm được",
        `${skipped.length} ảnh bị bỏ qua (chỉ nhận JPG, PNG, WebP; mỗi ảnh tối đa 5 MB). Các ảnh còn lại vẫn được giữ.`,
      );
    }
  };

  const pickFromLibrary = async () => {
    /**
     * Permission first. A denial is a normal outcome, not an error: the
     * message explains what to do and offers the settings screen, because on
     * Android a denied permission cannot be re-requested from the app.
     */
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      settingsAlert(
        "Cần quyền truy cập ảnh",
        "AgriMarket cần quyền đọc thư viện ảnh để bạn đính kèm ảnh minh chứng. Hãy cấp quyền trong Cài đặt.",
      );
      return;
    }

    const remaining = MAX_EVIDENCE - items.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      // A first-pass quality cut; the manipulator pass below resizes to 1600px.
      quality: 0.8,
      exif: false,
    });
    // Cancelled is a normal outcome — no alert, form untouched.
    if (result.canceled) return;

    /**
     * Extra selections beyond the remaining slots are dropped here rather
     * than at submit time, so the counter the customer sees is always the
     * truth about what will be sent.
     */
    await acceptAssets(result.assets.slice(0, remaining), items.length);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      settingsAlert(
        "Cần quyền camera",
        "AgriMarket cần quyền camera để bạn chụp ảnh minh chứng. Hãy cấp quyền trong Cài đặt.",
      );
      return;
    }

    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
        exif: false,
      });
    } catch {
      Alert.alert(
        "Không mở được camera",
        "Thiết bị không có camera hoặc camera đang bận. Vui lòng thử chọn ảnh từ thư viện.",
      );
      return;
    }
    if (result.canceled) return;
    await acceptAssets(result.assets.slice(0, MAX_EVIDENCE - items.length), items.length);
  };

  /**
   * The "Thêm ảnh" entry point: an action sheet with exactly the two mandated
   * choices — camera or library — plus cancel. A denied-then-cancelled flow
   * leaves the form untouched.
   */
  const pick = async () => {
    if (items.length >= MAX_EVIDENCE) {
      Alert.alert("Đã đủ ảnh", `Mỗi yêu cầu gửi tối đa ${MAX_EVIDENCE} ảnh.`);
      return;
    }

    setBusy(true);
    try {
      await new Promise<void>((resolve) => {
        Alert.alert("Thêm ảnh minh chứng", `Tối đa ${MAX_EVIDENCE} ảnh (JPG, PNG, WebP).`, [
          {
            text: "Chụp ảnh bằng camera",
            onPress: () => {
              void takePhoto()
                .catch(() => Alert.alert("Không chụp được ảnh", "Vui lòng thử lại."))
                .finally(() => resolve());
            },
          },
          {
            text: "Chọn ảnh từ thư viện",
            onPress: () => {
              void pickFromLibrary()
                .catch(() => Alert.alert("Không chọn được ảnh", "Vui lòng thử lại."))
                .finally(() => resolve());
            },
          },
          { text: "Hủy", style: "cancel", onPress: () => resolve() },
        ]);
      });
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
