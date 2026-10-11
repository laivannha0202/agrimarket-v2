/**
 * Shared UI primitives — the single place the UI Kit's visual language lives.
 *
 * Design rules enforced here:
 * - `StateView` renders exactly ONE state (loading | empty | error). It never
 *   reserves fixed height, so an error can't leave a screen-tall blank gap.
 * - `Screen`/`Card` carry the shared padding + border tokens.
 * - Illustrations come from `design-assets`; a *network* graphic is shown only
 *   for a connectivity failure, never for a backend business error (a wrong
 *   picture is a false claim about what went wrong).
 * - Every interactive element is >= `TOUCH` (44dp) tall and carries
 *   `accessibilityRole`, because the mockups' compact rows are easy to get
 *   wrong and an undersized target is a real defect, not a style choice.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { designAssets, emptyStateAsset, type EmptyStateKind } from "../lib/design-assets";
import { type LoadState } from "../lib/load-state";
import { colors, elevation, radius, spacing, toneColors, TOUCH, type Tone } from "../lib/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/* --------------------------------------------------------------- containers -- */

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/**
 * Sticky bottom bar for stack screens (product detail, checkout).
 *
 * Adds the device bottom inset as padding, so the CTA clears the Android
 * gesture bar / navigation buttons instead of hiding under them. Tab screens
 * must NOT use this — their tab bar already carries the inset.
 */
export function BottomBar({
  children,
  style,
  safeArea = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Add the device bottom inset. Set `false` on a TAB screen: the tab bar
   * already sits below the content and carries the inset, so adding it again
   * would leave a double gap above the tab bar.
   */
  safeArea?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.bottomBar, elevation.bar, { paddingBottom: spacing.md + (safeArea ? insets.bottom : 0) }, style]}
    >
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------- text -- */

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

/* ------------------------------------------------------------------ badge -- */

export function Badge({ label, tone, icon }: { label: string; tone: Tone; icon?: IconName }) {
  const t = toneColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }]}>
      {icon ? <Ionicons name={icon} size={11} color={t.fg} /> : null}
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------- chip -- */

/**
 * Selectable pill (category / filter / sort). `active` inverts to the brand
 * green. `icon` is optional artwork or a glyph — the kit only has four category
 * glyphs, so a chip without one renders as plain text rather than a fake icon.
 */
export function Chip({
  label,
  active = false,
  onPress,
  icon,
  style,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed, style]}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? "#fff" : colors.text} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/* --------------------------------------------------------------- section --- */

/**
 * Section header with an optional right-hand action.
 *
 * Carries its own `marginHorizontal` because the screens that use it render
 * inside a full-bleed ScrollView (their other blocks — cards, chips, grid rows
 * — each bring their own horizontal margin). Without this the title and the
 * "Xem tất cả" action sit flush against the screen edge and look clipped.
 */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
  icon,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionTitleRow}>
        {icon ? <Ionicons name={icon} size={17} color={colors.primary} /> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={10}
          accessibilityRole="button"
          style={({ pressed }) => [styles.sectionActionRow, pressed && styles.pressed]}
        >
          <Text style={styles.sectionAction}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- buttons -- */

/**
 * Navigation pressable that KEEPS function-form styles.
 *
 * WHY THIS EXISTS (a real, silent bug):
 * `<Link asChild>` renders its child through Radix `Slot`. For the `style` prop
 * Radix's `mergeProps` does `{ ...slotPropValue, ...childPropValue }`. When the
 * child's style is the RN callback form — `style={({ pressed }) => [...]}` —
 * spreading a *function* produces `{}`, so the child is rendered with **no
 * styles at all**. No error is thrown: cards simply lost their border, padding,
 * radius and flex direction, and list rows collapsed into plain stacked text.
 *
 * `Link` cannot be fixed from here, so this wrapper navigates itself and lets
 * React Native evaluate the style function normally. Use it for any pressable
 * that needs `pressed` feedback; a static `style` object is still fine directly
 * inside `Link asChild`.
 */
export function LinkPress({
  href,
  children,
  style,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  href: Href;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={() => {
        onPress?.();
        router.push(href);
      }}
      style={style}
    >
      {children}
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
  icon,
  loading = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: IconName;
  loading?: boolean;
  compact?: boolean;
}) {
  const blocked = Boolean(disabled) || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        compact && styles.buttonCompact,
        blocked && styles.disabled,
        pressed && !blocked && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : icon ? (
        <Ionicons name={icon} size={17} color="#fff" />
      ) : null}
      <Text style={styles.primaryText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  disabled,
  style,
  icon,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: IconName;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghost,
        compact && styles.buttonCompact,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={17} color={colors.primary} /> : null}
      <Text style={styles.ghostText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------ qty stepper -- */

/**
 * Quantity stepper. `max`/`min` are enforced by the *caller's* data (server
 * stock), and the buttons are disabled at the bounds so an out-of-range value
 * can't be produced by tapping — the backend would reject it anyway, but the
 * customer shouldn't have to find that out.
 */
export function QtyStepper({
  value,
  onChange,
  min = 1,
  max,
  disabled = false,
  busy = false,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  busy?: boolean;
}) {
  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;
  const lock = disabled || busy;
  return (
    <View style={styles.stepper}>
      <Pressable
        style={[styles.stepBtn, (atMin || lock) && styles.stepBtnOff]}
        disabled={atMin || lock}
        onPress={() => onChange(value - 1)}
        accessibilityRole="button"
        accessibilityLabel="Giảm số lượng"
        accessibilityState={{ disabled: atMin || lock }}
      >
        <Ionicons name="remove" size={18} color={atMin || lock ? colors.mutedSoft : colors.text} />
      </Pressable>
      <Text style={styles.stepValue}>{busy ? "…" : value}</Text>
      <Pressable
        style={[styles.stepBtn, (atMax || lock) && styles.stepBtnOff]}
        disabled={atMax || lock}
        onPress={() => onChange(value + 1)}
        accessibilityRole="button"
        accessibilityLabel="Tăng số lượng"
        accessibilityState={{ disabled: atMax || lock }}
      >
        <Ionicons name="add" size={18} color={atMax || lock ? colors.mutedSoft : colors.text} />
      </Pressable>
    </View>
  );
}

/* ----------------------------------------------------------- state blocks -- */

/** Inline spinner + label — never stretches to fill the parent. */
export function LoadingView({ message = "Đang tải…" }: { message?: string }) {
  return (
    <View style={styles.inlineState}>
      <ActivityIndicator size="small" color={colors.primary} />
      <Text style={styles.muted}>{message}</Text>
    </View>
  );
}

/**
 * Centred empty state with the situational illustration.
 *
 * `kind` is required so the caller has to decide *why* the list is empty
 * (see `emptyStateKind`) instead of defaulting to a generic picture.
 * `fill` is opt-in: only pass it when the view is a direct child of a
 * full-height container (never inside a ScrollView).
 */
export function EmptyView({
  message,
  kind,
  title,
  actionLabel,
  onAction,
  fill = false,
  illustration = true,
}: {
  message: string;
  kind: EmptyStateKind;
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
  fill?: boolean;
  /** Turn off for compact in-card empties (e.g. a section with no rows). */
  illustration?: boolean;
}) {
  return (
    <View style={[styles.stateBlock, fill && styles.stateFill]}>
      {illustration ? <Image source={emptyStateAsset(kind)} style={styles.stateArt} resizeMode="contain" /> : null}
      {title ? <Text style={styles.stateTitle}>{title}</Text> : null}
      <Text style={styles.stateText}>{message}</Text>
      {actionLabel && onAction ? (
        <PrimaryButton label={actionLabel} onPress={onAction} style={styles.stateCta} />
      ) : null}
    </View>
  );
}

/**
 * Error state.
 *
 * `network` selects the offline illustration and is set ONLY when the request
 * never reached the server (`ApiError.status === 0`). A 4xx/5xx answer from the
 * backend is a *business* error: showing "mất kết nối mạng" for it would tell
 * the customer to check their Wi-Fi when the server actually replied.
 */
export function ErrorView({
  message,
  onRetry,
  fill = false,
  network = false,
  title,
}: {
  message: string;
  onRetry?: () => void;
  fill?: boolean;
  network?: boolean;
  title?: string;
}) {
  return (
    <View style={[styles.stateBlock, fill && styles.stateFill]}>
      {network ? (
        <Image source={designAssets.emptyNetwork} style={styles.stateArt} resizeMode="contain" />
      ) : (
        <View style={styles.errorIcon}>
          <Ionicons name="alert-circle-outline" size={26} color={colors.danger} />
        </View>
      )}
      <Text style={styles.errorTitle}>{title ?? (network ? "Không kết nối được máy chủ" : "Đã xảy ra lỗi")}</Text>
      <Text style={styles.error}>{message}</Text>
      {onRetry ? <GhostButton label="Thử lại" onPress={onRetry} icon="refresh" style={styles.retry} /> : null}
    </View>
  );
}

/**
 * Exactly one visual state at a time. Prevents the "error AND empty together"
 * bug by making the priority explicit instead of relying on independent `if`s.
 * The machine itself lives in `lib/load-state.ts` so it stays unit-testable.
 */
export { resolveLoadState, isReady, type LoadState } from "../lib/load-state";

export function StateView({
  state,
  loadingMessage = "Đang tải…",
  errorMessage,
  emptyMessage,
  emptyKind,
  onRetry,
  network = false,
}: {
  state: LoadState;
  loadingMessage?: string;
  errorMessage?: string;
  emptyMessage?: string;
  /** Required when the state can be `empty` — see `EmptyView`. */
  emptyKind?: EmptyStateKind;
  onRetry?: () => void;
  network?: boolean;
}) {
  if (state === "loading") return <LoadingView message={loadingMessage} />;
  if (state === "error") {
    return <ErrorView message={errorMessage ?? "Không tải được dữ liệu."} onRetry={onRetry} network={network} />;
  }
  if (state === "empty") {
    return <EmptyView message={emptyMessage ?? "Chưa có dữ liệu."} kind={emptyKind ?? "search"} />;
  }
  return null;
}

/* ------------------------------------------------------------- thumbnails -- */

/**
 * Product thumbnail backed by a real uploaded image.
 *
 * Three deliberate behaviours:
 * - No url at all -> neutral leaf placeholder (never a stock photo).
 * - A url that FAILS to load (deleted upload, wrong host) -> the same
 *   placeholder, because an empty grey box looks like a layout bug and a
 *   leftover `Agri` label looked like a logo.
 * - `fill` stretches to the parent box instead of a fixed square — used by the
 *   grid card, which owns its own aspect ratio.
 */
export function ProductThumb({
  uri,
  size = 72,
  fill = false,
  style,
  rounded = true,
}: {
  uri: string | null;
  size?: number;
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  rounded?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  const box: StyleProp<ViewStyle> = fill
    ? { width: "100%", height: "100%", borderRadius: 0 }
    : { width: size, height: size, borderRadius: rounded ? radius.sm : 0 };

  if (!uri || failed) {
    return (
      <View style={[styles.thumbFallback, box, style]}>
        <Ionicons name="leaf-outline" size={fill ? 28 : Math.max(16, size / 3)} color={colors.primaryBorder} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      onError={() => setFailed(true)}
      style={[{ backgroundColor: colors.primarySoft }, box, style] as StyleProp<ImageStyle>}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page, padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  bottomBar: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },

  title: { fontSize: 20, fontWeight: "700", color: colors.textStrong, marginBottom: spacing.sm },
  subtitle: { fontSize: 15, fontWeight: "600", color: colors.text, marginBottom: 2 },
  muted: { fontSize: 13, color: colors.muted },
  error: { fontSize: 13.5, color: colors.danger, textAlign: "center", lineHeight: 19 },
  errorTitle: { fontSize: 15, fontWeight: "700", color: colors.textStrong },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.textStrong },
  sectionActionRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  sectionAction: { fontSize: 13, color: colors.primary, fontWeight: "700" },

  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: "600" },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 36,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  chipTextActive: { color: "#fff" },

  primary: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    minHeight: TOUCH,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  ghost: {
    flexDirection: "row",
    gap: 6,
    borderColor: colors.primaryBorder,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: TOUCH,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  ghostText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  buttonCompact: { minHeight: 38, marginTop: 0, paddingHorizontal: spacing.md },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },

  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepBtn: {
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  stepBtnOff: { opacity: 0.5 },
  stepValue: { fontSize: 15, fontWeight: "700", minWidth: 36, textAlign: "center", color: colors.textStrong },

  // Inline states: content-height only, so an error never leaves a blank hole.
  inlineState: { paddingVertical: spacing.md, alignItems: "center", gap: spacing.sm },
  stateBlock: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  stateFill: { flex: 1 },
  stateArt: { width: 132, height: 132, marginBottom: spacing.xs },
  stateTitle: { fontSize: 16, fontWeight: "700", color: colors.textStrong, textAlign: "center" },
  stateText: { fontSize: 13.5, color: colors.muted, textAlign: "center", lineHeight: 19 },
  stateCta: { alignSelf: "stretch", marginTop: spacing.md },
  retry: { alignSelf: "center", minWidth: 140, marginTop: spacing.sm },

  thumbFallback: {
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    borderColor: colors.primaryBorder,
    borderWidth: 1,
  },
});
