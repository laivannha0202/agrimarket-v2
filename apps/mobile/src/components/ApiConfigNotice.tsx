import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigNotice } from "../lib/config";
import { colors, spacing } from "../lib/theme";

/**
 * Visible hint when `.env` is missing or points at localhost (phone can't use it).
 * Top inset is padding so the bar clears the Android status bar.
 */
export function ApiConfigNotice() {
  const notice = apiConfigNotice();
  const insets = useSafeAreaInsets();
  if (!notice) return null;
  return (
    <View style={[styles.bar, { paddingTop: spacing.xs + insets.top }]}>
      <Text style={styles.text}>{notice}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.primarySoft,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    borderBottomColor: colors.primaryBorder,
    borderBottomWidth: 1,
  },
  text: { color: colors.primary, fontSize: 12, fontWeight: "600", textAlign: "center" },
});
