"use client";

/**
 * Shared "app-style" building blocks for the storefront.
 *
 * These replicate the Mobile app's `src/components/ui.tsx` primitives
 * (SectionHeader, Badge, Chip, QtyStepper, BottomBar, buttons) so the web and
 * the app share one visual language: hairline borders, 8-16px radii, a 44px
 * touch target minimum and the AgriMarket green (#0b7a39).
 */

import {
  Box,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  UnstyledButton,
  type ButtonProps,
  type CardProps,
  type ElementProps,
} from "@mantine/core";
import { IconChevronRight, IconCircle, IconCircleCheck, IconCheck, IconMinus, IconPlus } from "@tabler/icons-react";
import Link from "next/link";
import type { CSSProperties, ElementType, ReactElement, ReactNode } from "react";
import { toneColors } from "@/theme";
import type { Tone } from "@/lib/status";

/**
 * White surface card matching the Mobile `Card` (radius 12, hairline border).
 *
 * `component` / `href` are forwarded so a card can itself be a link
 * (`<AppCard component={Link} href={...}>`), same as Mantine's polymorphic
 * components. Card's own `padding` prop is not responsive, so pass the
 * responsive padding through the `p` style prop instead.
 */
type AppCardProps = CardProps & {
  children?: ReactNode;
  /** Render as another element — e.g. `component={Link}` for a clickable card. */
  component?: ElementType;
  /** Forwarded when `component` is a link. */
  href?: string;
};

export function AppCard({ children, radius = 12, padding = 12, ...rest }: AppCardProps) {
  const PolymorphicCard = Card as unknown as (props: AppCardProps) => ReactElement;
  return (
    <PolymorphicCard {...rest} radius={radius} padding={padding}>
      {children}
    </PolymorphicCard>
  );
}

/** Status pill with the Mobile tone palette (bg / fg / border per tone). */
export function ToneBadge({
  tone,
  children,
  icon,
}: {
  tone: Tone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const t = toneColors[tone] ?? toneColors.gray;
  return (
    <Box
      component="span"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.fg,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: "16px",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {children}
    </Box>
  );
}

/** Pill chip (sort/filter), filled green when active — Mobile `Chip`. */
export function FilterChip({
  active = false,
  children,
  icon,
  href,
  onClick,
  disabled,
}: {
  active?: boolean;
  children: ReactNode;
  icon?: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    minHeight: 36,
    borderRadius: 999,
    border: `1px solid ${active ? "var(--agri-primary)" : "var(--agri-border)"}`,
    background: active ? "var(--agri-primary)" : "var(--agri-surface)",
    color: active ? "#ffffff" : "var(--agri-text)",
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };

  if (href && !disabled) {
    return (
      <Link href={href} style={style}>
        {icon}
        {children}
      </Link>
    );
  }

  return (
    <button type="button" style={style} onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  );
}

/** Section header: bold title (+ icon) with an optional "Xem tất cả" action. */
export function SectionHeader({
  title,
  icon,
  href,
  linkLabel = "Xem tất cả",
  mb = 8,
  mt = 4,
}: {
  title: string;
  icon?: ReactNode;
  href?: string;
  linkLabel?: string;
  mb?: number;
  mt?: number;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" align="center" mt={mt} mb={mb} gap="sm">
      <Group gap={8} wrap="nowrap" align="center">
        {icon ? (
          <Box c="var(--agri-primary)" style={{ display: "inline-flex" }}>
            {icon}
          </Box>
        ) : null}
        <Text fz={16} fw={700} c="var(--agri-text-strong)" lineClamp={1}>
          {title}
        </Text>
      </Group>
      {href ? (
        <UnstyledButton
          component={Link}
          href={href}
          style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 2 }}
        >
          <Text fz={13} fw={700} c="var(--agri-primary)">
            {linkLabel}
          </Text>
          <IconChevronRight size={14} color="var(--agri-primary)" />
        </UnstyledButton>
      ) : null}
    </Group>
  );
}

/** Quantity stepper like the Mobile `QtyStepper` (36px square buttons). */
export function QtyStepper({
  value,
  min = 1,
  max,
  onChange,
  disabled = false,
  busy = false,
  ariaLabel = "Số lượng",
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
}) {
  const canDec = !disabled && !busy && value > min;
  const canInc = !disabled && !busy && (max === undefined || value < max);

  const buttonStyle = (enabled: boolean): CSSProperties => ({
    width: 36,
    height: 36,
    display: "grid",
    placeItems: "center",
    background: "transparent",
    border: "none",
    color: "var(--agri-text-strong)",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.4,
  });

  return (
    <Group
      gap={0}
      wrap="nowrap"
      role="group"
      aria-label={ariaLabel}
      style={{
        border: "1px solid var(--agri-border-strong)",
        borderRadius: 8,
        overflow: "hidden",
        width: "fit-content",
        background: "var(--agri-surface)",
      }}
    >
      <UnstyledButton
        aria-label="Giảm số lượng"
        aria-disabled={!canDec}
        onClick={() => canDec && onChange(value - 1)}
        style={buttonStyle(canDec)}
      >
        <IconMinus size={18} />
      </UnstyledButton>
      <Text
        ta="center"
        fz={15}
        fw={700}
        style={{ minWidth: 40, lineHeight: "36px" }}
        aria-live="polite"
      >
        {busy ? "…" : value}
      </Text>
      <UnstyledButton
        aria-label="Tăng số lượng"
        aria-disabled={!canInc}
        onClick={() => canInc && onChange(value + 1)}
        style={buttonStyle(canInc)}
      >
        <IconPlus size={18} />
      </UnstyledButton>
    </Group>
  );
}

/**
 * Bottom action bar (cart totals, checkout CTA, product buy bar).
 *
 * On phones it is fixed to the bottom edge (`--above-tabs` lifts it above the
 * tab bar); on desktop it is a sticky strip inside the page column.
 */
export function BottomBar({
  children,
  aboveTabs = false,
}: {
  children: ReactNode;
  aboveTabs?: boolean;
}) {
  return (
    <Box
      className={`agri-bottom-bar${aboveTabs ? " agri-bottom-bar--above-tabs" : ""}`}
      px={{ base: 12, sm: 0 }}
      pt={{ base: 12, sm: 16 }}
    >
      {children}
    </Box>
  );
}

/** Key/value row used across order, trace and account detail cards. */
export function KVRow({
  label,
  value,
  strong = false,
  valueColor,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  valueColor?: string;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
      <Text fz={13} c="var(--agri-muted)" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text fz={13.5} fw={strong ? 700 : 600} ta="right" style={{ wordBreak: "break-word" }} c={valueColor}>
        {value}
      </Text>
    </Group>
  );
}

/** Centered loading state in the Mobile style. */
export function LoadingView({ label = "Đang tải…" }: { label?: string }) {
  return (
    <Stack align="center" gap={8} py={40}>
      <Loader size={22} color="var(--agri-primary)" />
      <Text fz={13} c="var(--agri-muted)">
        {label}
      </Text>
    </Stack>
  );
}

/**
 * Selectable row used by the after-sales forms (return / complaint / review).
 *
 * Twin of the Mobile `styles.item` pressable: hairline border, green-soft fill
 * when active, a radio glyph on the right, and — unlike `Card` — no padding
 * surprises (8px, like the app).
 */
export function SelectCard({
  active = false,
  onClick,
  ariaLabel,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: `1px solid ${active ? "var(--agri-primary)" : "var(--agri-border)"}`,
        background: active ? "var(--agri-primary-soft)" : "var(--agri-surface)",
        borderRadius: 8,
        padding: 8,
        marginBottom: 8,
      }}
    >
      <Group gap={8} align="center" wrap="nowrap">
        <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
        {active ? (
          <IconCircleCheck size={20} color="var(--agri-primary)" aria-hidden />
        ) : (
          <IconCircle size={20} color="var(--agri-border-strong)" aria-hidden />
        )}
      </Group>
    </UnstyledButton>
  );
}

/**
 * Vertical progress tracker (Mobile `step` / `stepRail` drawing): a filled dot
 * per reached status, joined by a connector rail. Off-flow terminal states
 * (`CANCELLED`, `REJECTED`) are drawn by the caller — hand the happy-path
 * labels and the index the record currently sits at.
 */
export function FlowSteps({ labels, activeIndex }: { labels: string[]; activeIndex: number }) {
  return (
    <Stack gap={0}>
      {labels.map((label, index) => {
        const done = index <= activeIndex;
        return (
          <Group key={label} gap={8} align="stretch" wrap="nowrap">
            <Stack align="center" gap={0} w={18} style={{ flexShrink: 0 }}>
              <Box
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: done ? "var(--agri-primary)" : "var(--agri-border)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {done ? <IconCheck size={11} color="#ffffff" aria-hidden /> : null}
              </Box>
              {index < labels.length - 1 ? (
                <Box
                  style={{
                    width: 2,
                    background: index < activeIndex ? "var(--agri-primary)" : "var(--agri-border)",
                    flex: 1,
                    minHeight: 18,
                  }}
                />
              ) : null}
            </Stack>
            <Text
              fz={13}
              fw={done ? 600 : 400}
              c={done ? "var(--agri-text)" : "var(--agri-muted)"}
              pb={12}
              style={{ flex: 1 }}
            >
              {label}
            </Text>
          </Group>
        );
      })}
    </Stack>
  );
}

/**
 * Outline button with the AgriMarket green border/text (Mobile GhostButton).
 *
 * Mantine v9's component props no longer carry the DOM attributes, so the
 * element's own props are re-added here (`ElementProps<'button'>`) together
 * with the polymorphic `component` / `href` pair.
 */
type GhostButtonProps = ButtonProps &
  Omit<ElementProps<"button">, keyof ButtonProps> & {
    /** Render as another element — e.g. `component={Link}`. */
    component?: ElementType;
    /** Forwarded when `component` is a link. */
    href?: string;
  };

export function GhostButton(props: GhostButtonProps) {
  const PolymorphicButton = Button as unknown as (p: GhostButtonProps) => ReactElement;
  return (
    <PolymorphicButton
      variant="default"
      styles={{
        root: {
          borderColor: "var(--agri-primary-border)",
          color: "var(--agri-primary)",
          background: "var(--agri-surface)",
        },
      }}
      {...props}
    />
  );
}

/**
 * Desktop-only in-page title. On phones the title lives in the fixed app bar
 * (exactly like the native header in the Mobile app), so pages keep exactly one
 * heading at every breakpoint.
 */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <Text
      visibleFrom="md"
      fz={24}
      fw={700}
      c="var(--agri-text-strong)"
      style={{ lineHeight: 1.3 }}
    >
      {children}
    </Text>
  );
}
