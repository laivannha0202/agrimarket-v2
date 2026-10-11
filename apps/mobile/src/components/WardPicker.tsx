/**
 * Province + commune picker for the 2025 two-level address model (mobile).
 *
 * WHY THIS COMPONENT EXISTS
 *
 * The 104 Hưng Yên xã/phường are Government reference data that must exist in
 * exactly one place. They live in the backend catalogue and reach this form
 * through `GET /locations/provinces` and `GET /locations/provinces/:code/wards`
 * — the picker never embeds its own list, and it never lets a customer type a
 * commune name, because a typed name cannot be validated against a code.
 *
 * The list is fetched ONCE per province (104 rows) and filtered locally while
 * the customer types, so the search box does not issue a request per keystroke.
 * The filter is accent-insensitive: "pho hien" finds "Phường Phố Hiến".
 *
 * ONE MODAL PER LIST — WHY THIS IS WRITTEN THE WAY IT IS
 *
 * The previous version rendered a single `<Modal visible={sheet !== null}>` and
 * swapped the *content* between the province list and the ward list. That is
 * what made the sheet flicker: picking a province called `close()` while a
 * second tap had already set the sheet to `"ward"`, so one modal instance
 * animated out and the same instance animated back in showing the other list.
 * No timer can fix that — the state and the animation were the same object.
 *
 * Here each list owns its own `<Modal>` with its own boolean, so only one can
 * ever be mounted, closing is a single `setX(false)` per sheet, and no
 * transition can hand a closing sheet over to an opening one.
 *
 * React Native has no searchable `<Select>`, so the picker is a modal sheet with
 * a search box and a scrollable option list. The value that leaves it is always
 * the official CODE pair; the display name is resolved by the backend and stored
 * as `wardName`, so a forged commune name cannot travel with a code.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { errorMessage, isNetworkError } from "../lib/api-client";
import { wardMatches, type AddressForm } from "../lib/address";
import { resources } from "../lib/resources";
import { colors, radius, spacing, TOUCH } from "../lib/theme";

export interface WardPickerProps {
  form: AddressForm;
  onChange: (patch: Partial<AddressForm>) => void;
  disabled?: boolean;
}

export function WardPicker({ form, onChange, disabled }: WardPickerProps) {
  const [provinceSheet, setProvinceSheet] = useState(false);
  const [wardSheet, setWardSheet] = useState(false);
  const [search, setSearch] = useState("");

  const provinces = useQuery({
    queryKey: ["locations", "provinces"],
    queryFn: () => resources.listProvinces(),
    // Reference data: it changes only when the Government publishes a new
    // resolution, so it is kept for the session.
    staleTime: 60 * 60_000,
  });

  const wards = useQuery({
    queryKey: ["locations", "wards", form.provinceCode],
    queryFn: () => resources.listWards(form.provinceCode),
    enabled: form.provinceCode.length > 0,
    staleTime: 60 * 60_000,
  });

  const provinceList = provinces.data ?? [];
  const wardList = useMemo(() => wards.data?.data ?? [], [wards.data]);

  const province = provinceList.find((p) => p.code === form.provinceCode) ?? null;
  const ward = wardList.find((w) => w.code === form.wardCode) ?? null;

  const onlyProvince = provinceList.length === 1 ? provinceList[0] : null;

  const filteredWards = useMemo(
    () => (search.trim() ? wardList.filter((w) => wardMatches(w, search)) : wardList),
    [wardList, search],
  );

  /**
   * Preselects the province when the storefront serves exactly one.
   *
   * Restricted to a genuinely NEW form (no codes and no legacy text). Doing it
   * on an edited legacy address would set a province code with no ward code,
   * which the form correctly refuses to save — so opening an old address would
   * silently make it uneditable until the customer picked a commune.
   */
  useEffect(() => {
    if (form.provinceCode || form.wardCode || form.legacyProvince) return;
    if (provinceList.length !== 1) return;
    const code = provinceList[0]!.code;
    if (code !== form.provinceCode) onChange({ provinceCode: code });
    // `onChange` is a stable state setter from the screen; including it would
    // re-run the effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinceList, form.provinceCode, form.wardCode, form.legacyProvince]);

  /**
   * Drops a commune that is not in the currently loaded catalogue. This is the
   * client-side mirror of the backend's province-membership check; the backend
   * still refuses a mismatched pair, so this only prevents a pointless round
   * trip.
   */
  useEffect(() => {
    if (!form.provinceCode || !form.wardCode) return;
    if (wards.isPending || wards.isError || wardList.length === 0) return;
    if (!wardList.some((w) => w.code === form.wardCode)) onChange({ wardCode: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.provinceCode, form.wardCode, wardList, wards.isPending, wards.isError]);

  /** Closes the ward sheet and clears the search box. Touches nothing else. */
  const closeWardSheet = () => {
    setWardSheet(false);
    setSearch("");
  };

  const closeProvinceSheet = () => setProvinceSheet(false);

  /**
   * Changing the province clears the commune: the previous code belongs to a
   * different catalogue and would otherwise be submitted as a mismatched pair
   * (which the backend would reject — the picker just does not create it).
   */
  const pickProvince = (code: string) => {
    onChange({ provinceCode: code, wardCode: "" });
    closeProvinceSheet();
  };

  /**
   * The customer's own words are kept; only the code pair changes. Nothing in
   * the form is reset, so closing the sheet can never lose an input.
   */
  const pickWard = (code: string) => {
    onChange({ wardCode: code });
    closeWardSheet();
  };

  const canPickWard = !disabled && form.provinceCode.length > 0 && !wards.isPending;

  return (
    <View>
      {/* --------------------------------------------------------- province -- */}
      {onlyProvince ? (
        <>
          <Text style={styles.label}>Tỉnh / Thành phố</Text>
          <View
            style={[styles.field, styles.fieldReadonly]}
            accessibilityRole="text"
            accessibilityLabel={`Tỉnh ${onlyProvince.fullName}`}
          >
            <Ionicons name="map-outline" size={16} color={colors.muted} />
            <Text style={styles.fieldText} numberOfLines={1}>
              {onlyProvince.fullName}
            </Text>
            <Ionicons name="lock-closed-outline" size={14} color={colors.mutedSoft} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.label}>Tỉnh / Thành phố</Text>
          <Pressable
            style={({ pressed }) => [styles.field, disabled && styles.disabled, pressed && styles.pressed]}
            onPress={() => setProvinceSheet(true)}
            disabled={disabled || provinces.isPending}
            accessibilityRole="button"
            accessibilityLabel="Chọn tỉnh thành phố"
          >
            <Ionicons name="map-outline" size={16} color={colors.muted} />
            <Text style={[styles.fieldText, !province && styles.placeholder]} numberOfLines={1}>
              {provinces.isPending
                ? "Đang tải…"
                : province
                  ? province.fullName
                  : "Chọn tỉnh/thành phố"}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.mutedSoft} />
          </Pressable>
        </>
      )}
      {provinces.isError ? (
        <Text style={styles.fieldError}>
          {errorMessage(provinces.error, "Chưa tải được danh sách tỉnh/thành phố.")}
        </Text>
      ) : null}

      <Text style={styles.label}>Xã / Phường</Text>
      <Pressable
        style={({ pressed }) => [styles.field, !canPickWard && styles.disabled, pressed && styles.pressed]}
        onPress={() => setWardSheet(true)}
        disabled={!canPickWard}
        accessibilityRole="button"
        accessibilityLabel="Chọn xã phường"
      >
        <Ionicons name="business-outline" size={16} color={colors.muted} />
        <Text style={[styles.fieldText, !ward && styles.placeholder]} numberOfLines={1}>
          {!form.provinceCode
            ? "Chọn tỉnh/thành phố trước"
            : wards.isPending
              ? "Đang tải…"
              : ward
                ? ward.fullName
                : "Chọn xã/phường"}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.mutedSoft} />
      </Pressable>
      {wards.isError ? (
        <Text style={styles.fieldError}>{errorMessage(wards.error, "Chưa tải được danh sách xã/phường.")}</Text>
      ) : null}
      {/* ------------------------------------------- province sheet (modal) -- */}
      {!onlyProvince ? (
        <Modal
          visible={provinceSheet}
          transparent
          animationType="slide"
          onRequestClose={closeProvinceSheet}
        >
          <Pressable
            style={styles.backdrop}
            onPress={closeProvinceSheet}
            accessibilityRole="button"
            accessibilityLabel="Đóng danh sách tỉnh thành phố"
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Chọn tỉnh/thành phố</Text>
              <Pressable
                onPress={closeProvinceSheet}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Đóng"
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {provinceList.map((p) => (
                <Pressable
                  key={p.code}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                  onPress={() => pickProvince(p.code)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: p.code === form.provinceCode }}
                >
                  <Text style={styles.optionText}>{p.fullName}</Text>
                  {p.code === form.provinceCode ? (
                    <Ionicons name="checkmark" size={17} color={colors.primary} />
                  ) : null}
                </Pressable>
              ))}
              {provinceList.length === 0 ? (
                <Text style={styles.emptyOption}>Chưa tải được danh sách tỉnh/thành phố.</Text>
              ) : null}
            </ScrollView>
          </View>
        </Modal>
      ) : null}

      {/* ----------------------------------------------- ward sheet (modal) -- */}
      <Modal
        visible={wardSheet}
        transparent
        animationType="slide"
        onRequestClose={closeWardSheet}
      >
        <Pressable
          style={styles.backdrop}
          onPress={closeWardSheet}
          accessibilityRole="button"
          accessibilityLabel="Đóng danh sách xã phường"
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Chọn xã/phường</Text>
            <Pressable
              onPress={closeWardSheet}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Đóng"
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <TextInput
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Tìm xã/phường (gõ không dấu cũng được)"
            placeholderTextColor={colors.mutedSoft}
            style={styles.search}
            accessibilityLabel="Tìm xã phường"
          />

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {filteredWards.map((w) => (
              <Pressable
                key={w.code}
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                onPress={() => pickWard(w.code)}
                accessibilityRole="button"
                accessibilityState={{ selected: w.code === form.wardCode }}
              >
                <Text style={styles.optionText}>{w.fullName}</Text>
                {w.code === form.wardCode ? (
                  <Ionicons name="checkmark" size={17} color={colors.primary} />
                ) : null}
              </Pressable>
            ))}

            {filteredWards.length === 0 ? (
              <Text style={styles.emptyOption}>
                {wards.isPending
                  ? "Đang tải danh sách xã/phường…"
                  : isNetworkError(wards.error)
                    ? "Không kết nối được máy chủ. Vui lòng kiểm tra Wi-Fi."
                    : "Không tìm thấy xã/phường. Thử gõ không dấu, ví dụ: pho hien"}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 4, marginTop: spacing.sm },
  field: {
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
  /**
   * A fixed province reads as a value, not as a control: muted background and
   * no chevron, so nobody taps it expecting a list.
   */
  fieldReadonly: { backgroundColor: colors.page, borderColor: colors.border },
  fieldText: { flex: 1, fontSize: 14, color: colors.text },
  placeholder: { color: colors.mutedSoft },
  fieldError: { fontSize: 12.5, color: colors.danger, marginTop: 4 },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },

  backdrop: { flex: 1, backgroundColor: "rgba(15,18,15,0.45)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    maxHeight: "78%",
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: colors.textStrong },
  search: {
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  list: { marginBottom: spacing.md },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    minHeight: TOUCH,
    paddingHorizontal: spacing.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { flex: 1, fontSize: 14, color: colors.text },
  emptyOption: {
    fontSize: 13,
    color: colors.muted,
    paddingVertical: spacing.lg,
    textAlign: "center",
    lineHeight: 19,
  },
});
