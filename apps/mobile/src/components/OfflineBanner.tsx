import NetInfo from "@react-native-community/netinfo";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../lib/theme";

/**
 * Banner khi mất mạng. Mọi màn hình đều đã có trạng thái lỗi + thử lại.
 *
 * Android runs edge-to-edge, so a bar pinned to the top of the root view would
 * sit *under* the status bar. The top inset is added as padding (not margin) so
 * the coloured background still fills the status-bar strip.
 */
export function OfflineBanner() {
  const net = NetInfo.useNetInfo();
  const insets = useSafeAreaInsets();
  if (net.isConnected !== false) return null;
  return (
    <View style={[styles.bar, { paddingTop: spacing.xs + insets.top }]}>
      <Text style={styles.text}>Mất kết nối mạng. Kiểm tra Wi-Fi và thử lại.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.danger, paddingBottom: spacing.xs, paddingHorizontal: spacing.md },
  text: { color: "#fff", fontSize: 12, fontWeight: "600", textAlign: "center" },
});
