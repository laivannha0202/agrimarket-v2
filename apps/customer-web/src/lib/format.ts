/**
 * Display formatting for Customer Web.
 *
 * Implemented once in `@agrimarket/shared-domain` (money `136000` ->
 * `"136.000 ₫"`, dates `dd/mm/yyyy`) and re-exported here so every screen keeps
 * importing from `@/lib/format` while Web and Mobile render identical strings.
 */

export * from "@agrimarket/shared-domain/format";
