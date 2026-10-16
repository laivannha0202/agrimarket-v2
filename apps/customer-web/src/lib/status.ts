/**
 * Status label + tone mapping for Customer Web.
 *
 * The labels, tones and flow orders are implemented once in
 * `@agrimarket/shared-domain` so Web and Mobile cannot drift apart; this module
 * keeps the historical `@/lib/status` import path every screen uses.
 */

export * from "@agrimarket/shared-domain/statuses";
export type { Tone } from "@agrimarket/shared-domain/types";
