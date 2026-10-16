"use client";

/**
 * Mantine theme for the AgriMarket storefront.
 *
 * The palette, tone colours and layout constants come from
 * `@agrimarket/design-tokens` — the same tokens the Mobile app consumes — so
 * web and app look like one product: one AgriMarket green (#0b7a39), neutral
 * greys, hairline borders and a moderate radius. No gradients, no heavy
 * shadows.
 */

import { createTheme, type MantineColorsTuple } from "@mantine/core";
import {
  primaryScale,
  toneColors as tokenToneColors,
  layout as tokenLayout,
} from "@agrimarket/design-tokens";

/** AgriMarket primary green (light -> dark); shade 8 is the brand green. */
const agriGreen = [...primaryScale] as unknown as MantineColorsTuple;

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

/** Shared layout tokens (mirrors the Mobile shell). */
export const layout = tokenLayout;

/**
 * Tone palette for status badges/pills — the same `toneColors` the Mobile app
 * uses, consumed as one object so the two palettes cannot drift.
 */
export const toneColors = tokenToneColors;
