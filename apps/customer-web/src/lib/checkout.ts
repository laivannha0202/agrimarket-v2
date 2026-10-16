/**
 * Pure checkout helpers — the web twin of the Mobile app's `lib/checkout.ts`.
 *
 * These shape requests and interpret responses, never prices: the amount shown
 * at checkout always comes from `POST /orders/checkout-preview` and the backend
 * stays the only authority on money, stock and fees.
 */

import { ApiError } from "@/lib/api/client";
import type { CheckoutPreview } from "@/lib/api/types";

/**
 * What a 409 from `POST /orders/checkout` actually means.
 *
 * The backend uses 409 for several *different* conditions, and they need
 * different reactions — collapsing them into "the total changed" would make a
 * retryable in-flight conflict clear the customer's confirmation and demand
 * they re-confirm a total that had not changed at all.
 *
 * Classified by the backend's own message text, because that is the only signal
 * the API exposes (there is no machine-readable error code).
 */
export type CheckoutConflict =
  | "total-changed"
  | "in-flight"
  | "key-reuse"
  | "order-gone"
  | "other";

const TOTAL_CHANGED = /total changed/i;
const IN_FLIGHT = /still being processed/i;
const KEY_REUSE = /already used with a different checkout payload/i;
const ORDER_GONE = /no longer available/i;

/**
 * Every message the failure carries, raw text first.
 *
 * `ApiError.message` has already been run through `translateApiMessage`; the
 * backend's own English wording only survives in `body.message`. Both are
 * searched, so the classification works the same either way.
 */
function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return "";
  const parts: string[] = [err.message ?? ""];
  const raw = err.body?.message;
  if (Array.isArray(raw)) parts.push(...raw.map(String));
  else if (typeof raw === "string") parts.push(raw);
  return parts.join(" \u0000 ");
}

export function classifyCheckoutConflict(err: unknown): CheckoutConflict {
  if (!(err instanceof ApiError) || err.status !== 409) return "other";
  const msg = errorText(err);
  if (TOTAL_CHANGED.test(msg)) return "total-changed";
  if (IN_FLIGHT.test(msg)) return "in-flight";
  if (KEY_REUSE.test(msg)) return "key-reuse";
  if (ORDER_GONE.test(msg)) return "order-gone";
  return "other";
}

/**
 * WHY the customer must press once more before the order is created.
 *
 * Deliberately NOT derived from "has the customer confirmed the total" —
 * `checkout-preview` is the authoritative amount, so a first visit needs no
 * confirmation step at all. A confirmation step is owed in exactly ONE
 * situation: the backend re-priced the order *after* the customer was shown a
 * total (the 409 path). Then the new amount is displayed and the customer
 * accepts it with the same single button.
 */
export function needsTotalConfirm(
  preview: CheckoutPreview | undefined,
  pendingTotal: number | null,
): boolean {
  return preview !== undefined && pendingTotal !== null;
}
