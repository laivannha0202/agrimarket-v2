/**
 * Brand tokens. One green, neutral greys, light borders. No gradients,
 * no heavy shadows — matches the Customer Web palette.
 *
 * The UI Kit mockups suggest `#087A3B`; the shipped token stays `#0b7a39`
 * because that is the colour the Customer Web and the backend-issued assets
 * already use. Two near-identical greens in one product is a bug, not a style.
 */

export const colors = {
  primary: "#0b7a39",
  primaryDark: "#095c2c",
  primarySoft: "#eefaf1",
  primaryBorder: "#aee5bf",
  page: "#f7f8f7",
  surface: "#ffffff",
  text: "#1a1d1a",
  textStrong: "#0f120f",
  muted: "#5f6b5f",
  mutedSoft: "#8b968b",
  border: "#e6e8eb",
  borderStrong: "#d7dbd7",
  danger: "#c0392b",
  dangerSoft: "#fdecea",
  warning: "#b7791f",
  warningSoft: "#fdf3d7",
  info: "#1d4ed8",
  infoSoft: "#e8f0fe",
  /** Overlay behind "Hết hàng" so the photo stays readable underneath. */
  scrim: "rgba(15,18,15,0.45)",
} as const;

export type Tone = "green" | "blue" | "yellow" | "red" | "gray" | "orange";

export const toneColors: Record<Tone, { bg: string; fg: string; border: string }> = {
  green: { bg: "#eefaf1", fg: "#0b7a39", border: "#aee5bf" },
  blue: { bg: "#e8f0fe", fg: "#1d4ed8", border: "#bfcffb" },
  yellow: { bg: "#fdf3d7", fg: "#8a5a00", border: "#f0d48a" },
  orange: { bg: "#fdeedd", fg: "#b45309", border: "#f5c98a" },
  red: { bg: "#fdecea", fg: "#c0392b", border: "#f3b3ab" },
  gray: { bg: "#eef0ee", fg: "#5f6b5f", border: "#d7dbd7" },
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/** 4pt spacing scale. Use these instead of ad-hoc numbers. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

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
export const TOUCH = 44;

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
