/**
 * AgriMarket colour tokens — the single source of truth for the brand.
 *
 * One green, neutral greys, light borders. No gradients, no heavy shadows.
 * The UI Kit mockups once suggested `#087A3B`; the shipped brand green stays
 * `#0b7a39` because that is the colour the Customer Web, the Mobile app and
 * the backend-issued assets already use. Two near-identical greens in one
 * product would be a bug, not a style.
 *
 * `toneColors` is the status palette: every badge/pill on every platform maps
 * the shared `Tone` union to these exact background/foreground/border values.
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

export type BrandTone = "green" | "blue" | "yellow" | "red" | "gray" | "orange";

export const toneColors: Record<BrandTone, { bg: string; fg: string; border: string }> = {
  green: { bg: "#eefaf1", fg: "#0b7a39", border: "#aee5bf" },
  blue: { bg: "#e8f0fe", fg: "#1d4ed8", border: "#bfcffb" },
  yellow: { bg: "#fdf3d7", fg: "#8a5a00", border: "#f0d48a" },
  orange: { bg: "#fdeedd", fg: "#b45309", border: "#f5c98a" },
  red: { bg: "#fdecea", fg: "#c0392b", border: "#f3b3ab" },
  gray: { bg: "#eef0ee", fg: "#5f6b5f", border: "#d7dbd7" },
};

/**
 * Primary green scale, light -> dark (10 steps, shade 8 is the brand green).
 * Used by the Customer Web to seed Mantine's colour tuple; plain data, so any
 * platform can consume it.
 */
export const primaryScale = [
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
] as const;
