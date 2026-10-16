/**
 * Shared type scale: every screen on both platforms reads the same sizes.
 * Font families stay platform-specific (system stacks differ) — only the
 * numeric scale and weights are shared.
 */

export const fontSize = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 15,
  xl: 16,
  h2: 18,
  h1: 20,
  price: 24,
} as const;

export const fontWeight = {
  regular: "400",
  medium: "600",
  bold: "700",
} as const;

export type FontSizeToken = keyof typeof fontSize;
export type FontWeightToken = keyof typeof fontWeight;
