"use client";

/**
 * Mantine theme for the AgriMarket storefront.
 *
 * The palette and radii are copied 1:1 from the Mobile app
 * (`apps/mobile/src/lib/theme.ts`) so the web and the app look like the same
 * product: one AgriMarket green (#0b7a39), neutral greys, hairline borders and
 * a moderate radius. No gradients, no heavy shadows.
 */

import { createTheme, type MantineColorsTuple } from "@mantine/core";

/** AgriMarket primary green (light -> dark); shade 8 is the brand green. */
const agriGreen: MantineColorsTuple = [
  "#eefaf1",
  "#d7f2df",
  "#aee5bf",
  "#82d79c",
  "#5fcb80",
  "#48c36e",
  "#3bbf66",
  "#2ca655",
  "#0b7a39",
  "#095c2c",
];

export const theme = createTheme({
  primaryColor: "agri",
  primaryShade: { light: 8, dark: 8 },
  colors: { agri: agriGreen },
  defaultRadius: "md",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  headings: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
    fontWeight: "700",
  },
  radius: { md: "8px", lg: "12px" },
  shadows: {
    xs: "0 1px 2px rgba(16, 24, 40, 0.05)",
    sm: "0 1px 3px rgba(16, 24, 40, 0.08)",
    md: "0 2px 8px rgba(16, 24, 40, 0.08)",
    lg: "0 4px 16px rgba(16, 24, 40, 0.10)",
    xl: "0 8px 24px rgba(16, 24, 40, 0.12)",
  },
  fontSizes: {
    xs: "12px",
    sm: "13px",
    md: "14px",
    lg: "15px",
    xl: "16px",
  },
  components: {
    Button: {
      defaultProps: { fw: 600 },
    },
    Card: {
      defaultProps: { withBorder: true, shadow: undefined, radius: "lg", padding: 12 },
    },
    Paper: {
      defaultProps: { withBorder: true, shadow: undefined, radius: "lg" },
    },
    Badge: {
      defaultProps: { radius: 999 },
    },
    Modal: {
      defaultProps: { radius: "lg", centered: true },
    },
    /**
     * Mantine's visibility toggle ships an English `aria-label`
     * ("Toggle password visibility"). The storefront is Vietnamese, so the
     * screen-reader label is overridden here once for every password field.
     */
    PasswordInput: {
      defaultProps: {
        visibilityToggleButtonProps: { "aria-label": "Hiện hoặc ẩn mật khẩu" },
      },
    },
  },
});

/** Shared layout tokens. */
export const layout = {
  headerHeight: 64,
  headerHeightMobile: 56,
  containerSize: 1280,
  /** Bottom tab bar height on phones (mirrors the Mobile app's 60). */
  tabBarHeight: 60,
};

/**
 * Tone palette for status badges/pills, copied from the Mobile theme
 * (`toneColors`): background / foreground / border per tone.
 */
export const toneColors: Record<
  "green" | "blue" | "yellow" | "orange" | "red" | "gray",
  { bg: string; fg: string; border: string }
> = {
  green: { bg: "#eefaf1", fg: "#0b7a39", border: "#aee5bf" },
  blue: { bg: "#e8f0fe", fg: "#1d4ed8", border: "#bfcffb" },
  yellow: { bg: "#fdf3d7", fg: "#8a5a00", border: "#f0d48a" },
  orange: { bg: "#fdeedd", fg: "#b45309", border: "#f5c98a" },
  red: { bg: "#fdecea", fg: "#c0392b", border: "#f3b3ab" },
  gray: { bg: "#eef0ee", fg: "#5f6b5f", border: "#d7dbd7" },
};
