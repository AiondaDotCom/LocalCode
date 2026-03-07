// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "no-implicit-coercion": "error",
      "eqeqeq": ["error", "always"],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "vitest.config.ts", "eslint.config.js"],
  },
);
