/**
 * Tài khoản.
 *
 * Layout follows the UI Kit mockup (avatar, name, email, grouped rows, red
 * logout at the bottom), but the ROW LIST is filtered to what Backend V2
 * actually supports. The mockup shows "Sản phẩm yêu thích" and "Điểm thưởng";
 * neither has an endpoint, so neither appears here — a row that opens a dead
 * screen (or worse, a fake list) is exactly the kind of thing this pass removes.
 * The footer states which features are unavailable so the omission is explicit
 * rather than looking like an oversight.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, GhostButton, LinkPress, LoadingView, PrimaryButton } from "../../src/components/ui";
import { colors, elevation, radius, spacing, TOUCH } from "../../src/lib/theme";
import { useAuth } from "../../src/providers";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const SECTIONS: { title: string; links: { href: string; label: string; icon: IconName }[] }[] = [
  {
    title: "Mua sắm",
    links: [
      { href: "/orders", label: "Đơn hàng của tôi", icon: "receipt-outline" },
      { href: "/returns", label: "Trả hàng", icon: "return-down-back-outline" },
      { href: "/my-reviews", label: "Đánh giá của tôi", icon: "star-outline" },
    ],
  },
  {
    title: "Tài khoản",
    links: [
      { href: "/addresses", label: "Địa chỉ giao hàng", icon: "location-outline" },
      { href: "/change-password", label: "Đổi mật khẩu", icon: "key-outline" },
      { href: "/vouchers", label: "Mã giảm giá", icon: "pricetag-outline" },
    ],
  },
  {
    title: "Hỗ trợ",
    links: [
      { href: "/complaints", label: "Khiếu nại", icon: "chatbubble-ellipses-outline" },
      { href: "/farms", label: "Trang trại đối tác", icon: "leaf-outline" },
    ],
  },
];

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export default function AccountScreen() {
  const { user, hydrated, logout } = useAuth();
  const router = useRouter();

  if (!hydrated) {
    return (
      <View style={styles.statePage}>
        <LoadingView message="Đang tải…" />
      </View>
    );
  }

  if (!user) {
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.guestContent} keyboardShouldPersistTaps="handled">
        <View style={styles.avatarGuest}>
          <Ionicons name="person-outline" size={30} color={colors.primary} />
        </View>
        <Text style={styles.guestTitle}>Chào mừng đến AgriMarket</Text>
        <Text style={styles.guestText}>Đăng nhập để quản lý đơn hàng và địa chỉ giao hàng.</Text>
        <PrimaryButton label="Đăng nhập" onPress={() => router.push("/login")} style={styles.guestCta} />
        <GhostButton label="Đăng ký tài khoản" onPress={() => router.push("/register")} style={styles.guestCta} />
        <View style={styles.bottomPad} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Profile header */}
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(user.fullName)}</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {user.fullName}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {user.email}
        </Text>
        {user.phone ? (
          <Text style={styles.muted} numberOfLines={1}>
            {user.phone}
          </Text>
        ) : null}
      </View>

      {/* Editable profile — opens its own screen, not an inline form. */}
      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.section}>Thông tin cá nhân</Text>
        </View>
        <GhostButton
          label="Sửa thông tin"
          icon="create-outline"
          onPress={() => router.push("/profile-edit")}
        />
      </Card>

      {SECTIONS.map((section) => (
        <View key={section.title}>
          <Text style={styles.groupTitle}>{section.title}</Text>
          <Card style={styles.groupCard}>
            {section.links.map((l, idx) => (
              <LinkPress
                key={l.href}
                href={l.href as never}
                style={({ pressed }) => [styles.row, idx > 0 && styles.rowDivided, pressed && styles.pressed]}
                accessibilityLabel={l.label}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={l.icon} size={17} color={colors.primary} />
                </View>
                <Text style={styles.rowText}>{l.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedSoft} />
              </LinkPress>
            ))}
          </Card>
        </View>
      ))}

      <Pressable
        style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
        onPress={() => {
          void logout().then(() => router.replace("/(tabs)"));
        }}
        accessibilityRole="button"
      >
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={styles.logoutText}>Đăng xuất</Text>
      </Pressable>

      <Text style={styles.note}>
        Danh sách yêu thích và điểm thưởng chưa được backend V2 hỗ trợ nên không hiển thị trong ứng dụng.
      </Text>
      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.md },
  bottomPad: { height: spacing.xl },
  pressed: { opacity: 0.85 },
  statePage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    backgroundColor: colors.page,
    gap: spacing.sm,
  },

  guestContent: {
    alignItems: "stretch",
    padding: spacing.lg,
    paddingTop: spacing.xxl,
  },
  avatarGuest: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  guestTitle: { fontSize: 20, fontWeight: "700", color: colors.textStrong },
  guestText: { fontSize: 13.5, color: colors.muted, lineHeight: 19, marginTop: spacing.xs, marginBottom: spacing.lg },
  guestCta: { alignSelf: "stretch", marginTop: spacing.sm },

  profile: { alignItems: "center", gap: 3, marginBottom: spacing.lg, marginTop: spacing.sm },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
    ...elevation.card,
  },
  avatarText: { color: "#fff", fontSize: 24, fontWeight: "700" },
  name: { fontSize: 18, fontWeight: "700", color: colors.textStrong },
  muted: { fontSize: 13, color: colors.muted },

  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  section: { fontSize: 15, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  savedRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  savedText: { fontSize: 12, color: colors.primary, fontWeight: "700" },
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
    marginBottom: spacing.sm,
  },
  saveBtn: { marginTop: 0 },
  cancelBtn: { marginTop: spacing.sm },

  groupTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  groupCard: { padding: 0, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH + 8,
  },
  rowDivided: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },

  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    minHeight: TOUCH + 4,
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
  },
  logoutText: { color: colors.danger, fontWeight: "700" },
  note: { fontSize: 12, color: colors.muted, marginTop: spacing.md, textAlign: "center", lineHeight: 17 },
});
