import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Leftover npm staging copy of node_modules inside this app (58k files,
    // 17k of them .ts/.d.ts). ESLint's built-in ignore only covers a directory
    // literally named `node_modules`, so without this every lint/typecheck run
    // walks a duplicate of the entire dependency tree.
    "node_modules_npm_tmp/**",
  ]),
]);

export default eslintConfig;
