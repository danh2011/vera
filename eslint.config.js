import js from "@eslint/js"; import tseslint from "typescript-eslint"; import globals from "globals";
export default tseslint.config(
  { ignores: ["dist", "dist-server", "mobile", "data"] }, js.configs.recommended, ...tseslint.configs.recommended,
  { files: ["src/**/*.{ts,tsx}"], languageOptions: { globals: globals.browser } },
  { files: ["server/**/*.ts", "tests/**/*.ts", "shared/**/*.ts"], languageOptions: { globals: globals.node } },
);
