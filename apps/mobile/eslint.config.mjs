import eslintConfigExpo from "eslint-config-expo/flat.js";
import { defineConfig } from "eslint/config";

export default defineConfig([
  ...eslintConfigExpo,
  { ignores: [".expo/**", "dist/**"] },
  {
    // `scripts/**` runs on Node (integration checks, layout/screenshot probes),
    // not in the React Native runtime. `eslint-config-expo` declares browser
    // globals only, so Node built-ins like `Buffer` show up as `no-undef`.
    files: ["scripts/**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
  },
]);
