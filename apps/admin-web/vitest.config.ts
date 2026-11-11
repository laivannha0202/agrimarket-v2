import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.spec.{ts,tsx}"],
    css: false,
    // antd v6 + jsdom interactions (Select dropdowns, modal animations) render
    // slowly when spec files run in parallel; the 5s default timeout flakes
    // otherwise-green interactive tests under load.
    testTimeout: 20_000,
  },
});
