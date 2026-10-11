/**
 * Pure mapping from *real backend data* to UI Kit artwork keys.
 *
 * Deliberately free of asset imports (no `require()`, no React Native), so the
 * mapping can be unit-tested in the node vitest environment. `design-assets.ts`
 * attaches the actual images to these keys.
 *
 * HONESTY RULE: the kit has glyphs for exactly four categories and four
 * situations. Anything outside that set returns `null` / falls back to a text
 * presentation — we never substitute a different category's picture or invent a
 * fifth glyph, because a wrong glyph is a claim about the data.
 */

/* --------------------------------------------------------------- categories -- */

/** Slugs of the four categories the kit ships a glyph for. */
export const CATEGORY_ICON_SLUGS = ["rau-an-la", "trai-cay", "cu-qua", "gao-ngu-coc"] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_SLUGS)[number];

/**
 * Slug -> glyph key. The slug (not the name or id) is used because it is the
 * stable identifier of the real category row: an admin renaming "Rau ăn lá"
 * must not detach its glyph, and two categories can never share a slug.
 */
export function categoryIconKey(slug: string | null | undefined): CategoryIconKey | null {
  if (typeof slug !== "string") return null;
  const normalized = slug.trim().toLowerCase();
  return (CATEGORY_ICON_SLUGS as readonly string[]).includes(normalized)
    ? (normalized as CategoryIconKey)
    : null;
}

/* ------------------------------------------------------------ empty states -- */

/**
 * Situations that get a distinct empty-state graphic.
 *
 * - `cart`    — cart loaded successfully and is genuinely empty.
 * - `orders`  — order list loaded successfully and has no rows.
 * - `search`  — a filter/search matched nothing in data that *does* exist.
 * - `network` — the request never reached the server (offline / wrong API host).
 */
export type EmptyStateKind = "cart" | "orders" | "search" | "network";

/**
 * Chooses the graphic for an *empty* list, based on why it is empty.
 *
 * `search` wins over `listKind` on purpose: when the customer has filtered the
 * catalogue, "no products" means "no match", not "the shop is empty" — showing
 * the shop-is-empty artwork there would misrepresent the catalogue.
 *
 * `network` is never produced here: an unreachable backend is an *error* state,
 * not an empty one (see `ErrorView`), and the two must not be conflated.
 */
export function emptyStateKind(opts: { listKind: "cart" | "orders"; hasFilter: boolean }): EmptyStateKind {
  return opts.hasFilter ? "search" : opts.listKind;
}
