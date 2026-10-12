"use client";

/**
 * Mantine theme for the AgriMarket storefront.
 *
 * Deliberately restrained: one AgriMarket green, neutral greys, light borders
 * and a moderate radius. No gradients, no heavy shadows.
 */

import { createTheme, type MantineColorsTuple } from "@mantine/core";

/** AgriMarket primary green (light -> dark). */
const agriGreen: MantineColorsTuple = [
  "#eefaf1",
  "#d7f2df",
  "#aee5bf",
  "#82d79c",
  "#5fcb80",
  "#48c36e",
  "#3bbf66",
  "#2ca655",
  "#1f9148",
  "#0b7a39",
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
    fontWeight: "600",
  },
  radius: { md: "8px", lg: "12px" },
  shadows: {
    xs: "0 1px 2px rgba(16, 24, 40, 0.05)",
    sm: "0 1px 3px rgba(16, 24, 40, 0.08)",
    md: "0 2px 8px rgba(16, 24, 40, 0.08)",
    lg: "0 4px 16px rgba(16, 24, 40, 0.10)",
    xl: "0 8px 24px rgba(16, 24, 40, 0.12)",
  },
  components: {
    Button: {
      defaultProps: { fw: 600 },
    },
    Card: {
      defaultProps: { withBorder: true, shadow: undefined, radius: "md" },
    },
    Paper: {
      defaultProps: { withBorder: true, shadow: undefined },
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
};
