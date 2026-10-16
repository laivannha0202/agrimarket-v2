/**
 * Brand tokens. Values live in `@agrimarket/design-tokens` so the Customer Web
 * and the Mobile app can never drift apart: one green, neutral greys, light
 * borders. This file only adds the React-Native-specific pieces (elevation,
 * touch targets, line boxes) on top of those shared tokens.
 */

import { colors as tokenColors, spacing, radius, toneColors, type BrandTone } from "@agrimarket/design-tokens";

export const colors = tokenColors;

/** Status-badge tone, matching `toneColors` in the shared design tokens. */
export type Tone = BrandTone;

export { toneColors, radius, spacing };

/** Shared type scale so every screen reads the same. */
export const typography = {
  h1: { fontSize: 20, fontWeight: "700" as const, color: colors.textStrong },
  h2: { fontSize: 16, fontWeight: "700" as const, color: colors.textStrong },
  h3: { fontSize: 15, fontWeight: "600" as const, color: colors.text },
  body: { fontSize: 14, color: colors.text },
  small: { fontSize: 13, color: colors.text },
  caption: { fontSize: 12, color: colors.muted },
} as const;

/**
 * Product-name line boxes.
 *
 * `lineHeight` is explicit because the Vietnamese diacritics (ẩ, ộ, ữ) need more
 * room than the font's default line box gives them — the descenders were being
 * clipped in the 2-line grid card. `nameCard`/`nameRow` are the only two line
 * boxes a product name uses, so every grid cell is exactly the same height and
 * the 2-up rows never go ragged.
 */
export const productNameLineHeight = { grid: 18, row: 19 } as const;

/** Minimum comfortable touch target (Material / iOS HIG). */
export { TOUCH } from "@agrimarket/design-tokens";

/**
 * Elevation presets. RN maps `elevation` on Android and `shadow*` on iOS; both
 * are declared so a card looks the same on either platform. Kept deliberately
 * shallow — the mockups use a hairline border plus a very soft lift, not a
 * drop shadow.
 */
export const elevation = {
  none: {},
  card: {
    shadowColor: "#0f120f",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  /** Bottom action bars / sticky CTAs that must separate from scrolling content. */
  bar: {
    shadowColor: "#0f120f",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
} as const;
