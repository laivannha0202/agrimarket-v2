/**
 * Static registry for the UI Kit graphics shipped in `assets/design/`.
 *
 * Why a registry instead of inline `require()` at each call site:
 * - Metro resolves `require()` statically, so every path must be a literal.
 *   Collecting them here keeps the bundler happy and makes it obvious which
 *   files are actually used (an unused asset is dead weight in the bundle).
 * - The *decision* of which artwork applies lives in `design-asset-keys.ts`,
 *   which has no asset imports and is therefore unit-testable in node.
 *
 * HONESTY RULE: these are decorative illustrations and category glyphs only.
 * No asset here is ever a stand-in for a product/farm photo — those come from
 * the backend (`/uploads/...`). The one exception is the documented
 * `farmFallback`, shown *only* when a farm has no uploaded image and labelled as
 * an illustration, never presented as the real farm.
 */

import type { ImageSourcePropType } from "react-native";
import { categoryIconKey, type CategoryIconKey, type EmptyStateKind } from "./design-asset-keys";

/* ------------------------------------------------------------------ assets -- */

export const designAssets = {
  /** Brand mark used in the Home header and on the login screen. */
  brandLeafMark: require("../../assets/design/brand/agrimarket_leaf_mark_512.png") as ImageSourcePropType,
  /** Decorative banner on Home. Text-free, so the copy above it stays translatable. */
  homeHero: require("../../assets/design/home/hero_nong_san_no_text_1200x480.png") as ImageSourcePropType,
  /** Illustration for the trace tab / scan guidance. */
  traceScan: require("../../assets/design/trace/trace_scan_illustration_640x440.png") as ImageSourcePropType,
  /** Neutral farm illustration — only when the backend has no farm photo. */
  farmFallback: require("../../assets/design/farm/farm_fallback_1000x600.png") as ImageSourcePropType,
  /** Empty-state graphics, one per situation (see `emptyStateAsset`). */
  emptyCart: require("../../assets/design/empty_states/empty_cart_360.png") as ImageSourcePropType,
  emptyNetwork: require("../../assets/design/empty_states/empty_network_360.png") as ImageSourcePropType,
  emptyOrders: require("../../assets/design/empty_states/empty_orders_360.png") as ImageSourcePropType,
  emptySearch: require("../../assets/design/empty_states/empty_search_360.png") as ImageSourcePropType,
} as const;

const CATEGORY_ICON_SOURCES: Record<CategoryIconKey, ImageSourcePropType> = {
  "rau-an-la": require("../../assets/design/categories/category_rau_la_256.png") as ImageSourcePropType,
  "trai-cay": require("../../assets/design/categories/category_trai_cay_256.png") as ImageSourcePropType,
  "cu-qua": require("../../assets/design/categories/category_cu_qua_256.png") as ImageSourcePropType,
  "gao-ngu-coc": require("../../assets/design/categories/category_nau_san_256.png") as ImageSourcePropType,
};

const EMPTY_STATE_SOURCES: Record<EmptyStateKind, ImageSourcePropType> = {
  cart: designAssets.emptyCart,
  orders: designAssets.emptyOrders,
  search: designAssets.emptySearch,
  network: designAssets.emptyNetwork,
};

/* -------------------------------------------------------------- public API -- */

/** Glyph for a category slug, or null so the caller renders a text-only chip. */
export function categoryIcon(slug: string | null | undefined): ImageSourcePropType | null {
  const key = categoryIconKey(slug);
  return key ? CATEGORY_ICON_SOURCES[key] : null;
}

/** Illustration for an empty state. */
export function emptyStateAsset(kind: EmptyStateKind): ImageSourcePropType {
  return EMPTY_STATE_SOURCES[kind];
}

export { categoryIconKey, emptyStateKind } from "./design-asset-keys";
export type { CategoryIconKey, EmptyStateKind } from "./design-asset-keys";
