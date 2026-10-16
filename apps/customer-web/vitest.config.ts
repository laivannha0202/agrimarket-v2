import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the Web app.
 *
 * They cover the pure logic the checkout screen runs on — the "mua-ngay"
 * parameter, the checkout payload builder and the 409 classification — through
 * the app's own modules (`src/lib/*`), so a broken re-export of
 * `@agrimarket/shared-domain` fails here before it reaches a browser.
 *
 * `environment: "node"`: none of these modules touch the DOM. Component tests
 * would need jsdom, which this config deliberately does not set up yet.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@/*` path in tsconfig.json (Next resolves it itself).
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
