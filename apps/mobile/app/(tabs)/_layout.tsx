import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Platform, StyleSheet, Text, View, type ColorValue } from "react-native";
import { colors, spacing } from "../../src/lib/theme";
import { resources } from "../../src/lib/resources";
import { useAuth } from "../../src/providers";

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

/** Route names that own a tab — keeps `ICONS[routeName]` total. */
type RouteName = "index" | "catalog" | "trace" | "cart" | "account";

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

const ICONS: Record<RouteName, { on: IconName; off: IconName }> = {
  index: { on: "home", off: "home-outline" },
  catalog: { on: "grid", off: "grid-outline" },
  trace: { on: "qr-code", off: "qr-code-outline" },
  cart: { on: "cart", off: "cart-outline" },
  account: { on: "person", off: "person-outline" },
};

function TabIcon({ routeName, focused, color }: { routeName: RouteName; focused: boolean; color: ColorValue }) {
  const set = ICONS[routeName];
  return (
    <View style={styles.iconWrap}>
      <Ionicons name={focused ? set.on : set.off} size={22} color={color} />
    </View>
  );
}

/**
 * Cart tab icon with a live item-count badge.
 *
 * Same contract as the Web header badge: the count is the number of cart lines
 * the BACKEND reports (`items.length` of `GET /carts/me`), never a number this
 * app computes or keeps in a parallel store. The query is only enabled once the
 * session is hydrated and signed in, so a guest never sees a badge; it shares
 * the `["cart"]` query key with the cart screen, so add/remove invalidations
 * refresh the badge in the same render pass. Capped at `99+` so the pill cannot
 * grow a second line.
 */
function CartTabIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
  const { token, hydrated } = useAuth();
  const { data } = useQuery({
    queryKey: ["cart"],
    queryFn: () => resources.getCart(),
    enabled: hydrated && Boolean(token),
    staleTime: 10_000,
  });
  const count = data?.items.length ?? 0;

  return (
    <View style={styles.iconWrap}>
      <Ionicons name={focused ? ICONS.cart.on : ICONS.cart.off} size={22} color={color} />
      {count > 0 ? (
        <View style={styles.cartBadge}>
          <Text style={styles.cartBadgeText}>{count > 99 ? "99+" : count}</Text>
        </View>
      ) : null}
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
          tabBarIcon: ({ focused, color }) => <CartTabIcon focused={focused} color={color} />,
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
  // Red count pill on the cart tab, anchored to the icon's top-right corner.
  cartBadge: {
    position: "absolute",
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  cartBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700", lineHeight: 13 },
  // Explicit lineHeight keeps the Vietnamese glyphs (with their diacritics)
  // inside the box; the default `normal` line box was clipping them.
  label: { fontSize: 11, lineHeight: 15, fontWeight: "600", marginTop: 1, textAlign: "center" },
  labelActive: { color: colors.primary, fontWeight: "700" },
  labelIdle: { color: colors.mutedSoft },
});