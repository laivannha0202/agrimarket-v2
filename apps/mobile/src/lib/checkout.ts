/**
 * Checkout helpers for the Mobile app.
 *
 * All checkout rules — the buy-now parameter, the 409 classification, the
 * confirmation rules and the payload builder — live in
 * `@agrimarket/shared-domain/checkout` and are shared verbatim with Customer
 * Web. This module keeps the historical `./checkout` import path used across
 * the app and its tests.
 */

export * from "@agrimarket/shared-domain/checkout";
