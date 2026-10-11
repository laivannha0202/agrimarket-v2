/**
 * Shipping fee policy — decided by the backend, never by the client.
 *
 * The storefront ships from a single warehouse, so the policy is deliberately
 * simple: one flat fee per order, independent of how many partners the order
 * was split into (the customer pays one delivery charge, not one per parcel).
 *
 * This is the ONLY place a shipping fee is computed. `POST /orders/checkout`
 * ignores any client-supplied fee (the field is not part of the request DTO),
 * `POST /orders/checkout-preview` and the created order both use this function,
 * so the amount shown before submitting is the amount that gets charged.
 */
export const FLAT_SHIPPING_FEE = 20000;

/** Fee for an order with the given subtotal. Empty orders pay nothing. */
export function calculateShippingFee(subtotal: number): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  return FLAT_SHIPPING_FEE;
}
