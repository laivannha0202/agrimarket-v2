/**
 * Radii and the 4pt spacing scale, shared by Customer Web and Mobile.
 * Values are plain numbers (logical pixels) — each platform renders them its
 * own way; no platform style object lives here.
 */

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/** 4pt spacing scale. Use these instead of ad-hoc numbers. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/** Minimum comfortable touch target (Material / iOS HIG). */
export const TOUCH = 44;

/** Shared layout constants used by both shells. */
export const layout = {
  headerHeight: 64,
  headerHeightMobile: 56,
  containerSize: 1280,
  /** Bottom tab bar height on phones. */
  tabBarHeight: 60,
} as const;
