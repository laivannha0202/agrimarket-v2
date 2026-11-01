"use client";

import type { ReactNode } from "react";
import { Descriptions, Grid } from "antd";
import type { DescriptionsProps } from "antd";

export type DescItem = {
  key: string;
  label: ReactNode;
  children: ReactNode;
  span?: number;
};

const BREAKPOINTS = ["xs", "sm", "md", "lg", "xl", "xxl"] as const;

/**
 * Resolve the column count for the CURRENT breakpoint.
 *
 * `column` may be a plain number or antd's responsive map. Reading the first
 * entry of the map (as this helper used to) is wrong: `{ xs: 1, sm: 2 }` was
 * normalised for one column while antd rendered two, and on a phone a
 * `span: 2` item exceeded `column: 1` — which is exactly the
 * "Sum of column `span` in a line not match `column`" warning, with antd
 * silently clamping the row. `useBreakpoint` gives the same value antd uses.
 */
function useActiveColumn(column: number | Record<string, number>): number {
  const screens = Grid.useBreakpoint();
  if (typeof column === "number") return column;
  let active = column.xs ?? 1;
  for (const bp of BREAKPOINTS) {
    const value = column[bp];
    if (typeof value !== "number") continue;
    if (bp === "xs" || screens[bp]) active = value;
  }
  return active;
}

/**
 * Normalise spans so every rendered row fills the column count exactly.
 *
 * WHY THIS EXISTS
 *
 * antd lays out a `Descriptions` row by accumulating item spans until the total
 * reaches `column`. When a single item's span would push the total PAST the
 * column count, antd silently clamps that item's span to whatever room is left
 * and logs:
 *
 *   Warning: [antd: Descriptions] Sum of column `span` in a line not match
 *   `column` of Descriptions.
 *
 * That is easy to hit by accident, and it is what broke the admin order page:
 * "Thông tin chung" lists seven items at `column={2}` with two of them marked
 * `span: 2`, so `Người nhận` (span 1) was followed by `Địa chỉ giao` (span 2)
 * with only one column left. antd clamped the address to a single column, and
 * the cramped grid made every label and value wrap one character per line —
 * an admin saw "M ã đ ơ n" running down the page.
 *
 * So rather than trusting callers to count, the row is CLOSED early when the
 * next item cannot fit: a blank filler takes the remaining columns and the item
 * starts a fresh row with its full span intact. A short final row is padded the
 * same way. Every row then sums exactly to `column`, no span is ever clamped,
 * and a page can add or remove a field without breaking its own layout.
 */
function normalizeSpans(items: DescItem[], column: number): DescItem[] {
  if (items.length === 0) return items;
  // A single-column grid has no room for a full-width span; leaving `span: 2`
  // in place is what antd complains about (and then clamps silently).
  if (column <= 1) return items.map((i) => (i.span && i.span > 1 ? { ...i, span: 1 } : i));

  const out: DescItem[] = [];
  let filled = 0;
  let count = 0;

  const addFiller = (span: number): void => {
    out.push({ key: `__filler_${filled++}`, label: "", children: "", span });
  };

  for (const item of items) {
    // A span wider than the grid is meaningless; clamp it to the full width.
    const span = Math.min(Math.max(item.span ?? 1, 1), column);

    if (count > 0 && count + span > column) {
      addFiller(column - count);
      count = 0;
    }

    out.push(span === item.span ? item : { ...item, span });
    count += span;
    if (count >= column) count = 0;
  }

  if (count > 0) addFiller(column - count);
  return out;
}

/**
 * Consistent two-column key/value block used across detail pages.
 * Values should already be formatted (money/date/status) by the caller.
 */
export function InfoDescriptions({
  items,
  column = 2,
}: {
  items: DescItem[];
  column?: number | Record<string, number>;
}) {
  const activeColumn = useActiveColumn(column);
  const props: DescriptionsProps = {
    // Pass the RESOLVED number, not the responsive map. antd would otherwise
    // resolve the map a second time with its own breakpoint hook, and on the
    // first client render (before matchMedia answers) the two can disagree for
    // one paint — which is exactly when "Sum of column span … not match" is
    // logged. One source of truth, and the spans below always match it.
    column: activeColumn,
    size: "middle",
    bordered: true,
    // `layout` is deliberately NOT switched at runtime. antd computes its row
    // grouping once; flipping horizontal↔vertical when `useBreakpoint` resolves
    // left mixed rows behind and logged "Sum of column span … not match".
    // The phone problem (a 100px label column squeezing the value) is solved in
    // `globals.css` with `.agri-desc` widths instead.
    className: "agri-desc",
    items: normalizeSpans(items, activeColumn).map((i) => ({
      key: i.key,
      label: i.label,
      children: i.children,
      span: i.span,
    })),
  };
  return <Descriptions {...props} />;
}

/**
 * One-line display form of an address.
 *
 * TWO GENERATIONS, ONE ROW
 *
 * New addresses carry the official 2025 code pair (`provinceCode` + `wardCode`)
 * and the catalogue name the backend resolved into `wardName`; that model has no
 * district level. Addresses saved before the reorganisation have no codes and
 * keep their own free-text `ward`/`district`, which are never backfilled — an old
 * row must keep reading exactly the way it was saved.
 *
 * So `wardName` wins when present, and a district is only rendered when there is
 * no catalogue ward (otherwise an admin would see a district the address does not
 * actually have).
 */
export function formatAddress(addr: {
  detail?: string | null;
  village?: string | null;
  wardName?: string | null;
  wardCode?: string | null;
  ward?: string | null;
  district?: string | null;
  province?: string | null;
}): string {
  const commune = addr.wardName ?? addr.ward;
  const hasCatalogueWard = Boolean(addr.wardName);
  return [
    addr.detail,
    addr.village,
    commune,
    hasCatalogueWard ? null : addr.district,
    addr.province,
  ]
    .filter((part) => part && String(part).trim())
    .join(", ");
}
