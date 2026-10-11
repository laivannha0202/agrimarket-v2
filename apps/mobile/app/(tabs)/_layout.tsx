import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform, StyleSheet, Text, View, type ColorValue } from "react-native";
import { colors, spacing } from "../../src/lib/theme";

/**
 * Bottom tabs.
 *
 * Two Expo Go specific requirements are handled here:
 * 1. `tabBarIcon` MUST be provided for every screen. Without it expo-router's
 *    BottomTabBar falls back to `MissingIcon`, which literally renders the
 *    character "⏷" (U+23F7) — the "triangle instead of icon" bug.
 * 2. The bar height must grow by the Android/iOS bottom inset so labels are not
 *    clipped by the gesture bar / navigation buttons. `getTabBarHeight` only
 *    adds the inset when we don't hard-code `height`, so we set padding instead.
 */

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * Minimum bar height so the label is never flex-shrunk.
 *
 * expo-router's base height is 49dp, which only fits the icon. Measured
 * requirement for one item (see scripts/tabitem-probe.mjs):
 *   bar border(1) + bar paddingTop(4) + item padding(10)
 *   + icon block(28) + label margin(1) + label line box(15) = 59dp
 * Without this floor the label is the only flexible child, so it is
 * flex-shrunk to 12px and the Vietnamese diacritics are cut.
 */
const TAB_BAR_MIN_HEIGHT = 60;

const ICONS: Record<string, { on: IconName; off: IconName }> = {
  index: { on: "home", off: "home-outline" },
  catalog: { on: "grid", off: "grid-outline" },
  trace: { on: "qr-code", off: "qr-code-outline" },
  cart: { on: "cart", off: "cart-outline" },
  account: { on: "person", off: "person-outline" },
};

function TabIcon({ routeName, focused, color }: { routeName: string; focused: boolean; color: ColorValue }) {
  const set = ICONS[routeName] ?? { on: "ellipse", off: "ellipse-outline" };
  return (
    <View style={styles.iconWrap}>
      <Ionicons name={focused ? set.on : set.off} size={22} color={color} />
    </View>
  );
}

/** Always-visible label with breathing room, independent of the active tint. */
function TabLabel({ children, focused }: { children: string; focused: boolean }) {
  return (
    <Text numberOfLines={1} style={[styles.label, focused ? styles.labelActive : styles.labelIdle]}>
      {children}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { fontSize: 17, fontWeight: "700", color: colors.textStrong },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedSoft,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
        tabBarLabelPosition: "below-icon",
        // Labels render through our own component (see TabLabel) so they keep
        // a guaranteed height. `tabBarShowLabel` must stay true — setting it to
        // false makes BottomTabItem return null before our label is called.
        tabBarShowLabel: true,
        // Keeps the bar from being shoved around when a keyboard opens.
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Trang chủ",
          // The mockup has no separate title bar on Home: the brand row inside
          // the screen *is* the header. Leaving the native header on would stack
          // a bare "Trang chủ" title above the AgriMarket brand block.
          headerShown: false,
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Trang chủ</TabLabel>,
          tabBarIcon: ({ focused, color }) => <TabIcon routeName="index" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="catalog"
        options={{
          title: "Sản phẩm",
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Sản phẩm</TabLabel>,
          tabBarIcon: ({ focused, color }) => <TabIcon routeName="catalog" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trace"
        options={{
          title: "Truy xuất",
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Truy xuất</TabLabel>,
          tabBarIcon: ({ focused, color }) => <TabIcon routeName="trace" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Giỏ hàng",
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Giỏ hàng</TabLabel>,
          tabBarIcon: ({ focused, color }) => <TabIcon routeName="cart" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Tài khoản",
          tabBarLabel: ({ focused }) => <TabLabel focused={focused}>Tài khoản</TabLabel>,
          tabBarIcon: ({ focused, color }) => <TabIcon routeName="account" focused={focused} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    // Height is NOT hard-coded: expo-router adds the device bottom inset
    // (gesture bar / nav buttons) on top of the base 49dp.
    //
    // `minHeight` is required though. The 49dp base only fits the icon: the
    // row is icon(26) + label(~15) + item padding(10) + our paddingTop(4) = 55.
    // Without a floor the label is the only flexible child, so it gets
    // flex-shrunk to ~5px and the Vietnamese labels are cut in half.
    minHeight: TAB_BAR_MIN_HEIGHT,
    paddingTop: spacing.xs,
  },
  tabItem: { paddingBottom: Platform.OS === "android" ? spacing.xs : 0 },
  iconWrap: { alignItems: "center", justifyContent: "center", height: 26 },
  // Explicit lineHeight keeps the Vietnamese glyphs (with their diacritics)
  // inside the box; the default `normal` line box was clipping them.
  label: { fontSize: 11, lineHeight: 15, fontWeight: "600", marginTop: 1, textAlign: "center" },
  labelActive: { color: colors.primary, fontWeight: "700" },
  labelIdle: { color: colors.mutedSoft },
});