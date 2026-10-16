/**
 * `@agrimarket/shared-domain` — pure domain logic shared by the Customer Web
 * and Mobile apps.
 *
 * Rules for this package:
 *  - no React, no DOM, no React Native, no fetch, no storage;
 *  - nothing here decides money, stock or fees — the API does;
 *  - platform-specific adapters (routers, storage, UI kits) stay in the apps.
 */

export * from "./types";
export * from "./format";
export * from "./statuses";
export * from "./checkout";
export * from "./home";
