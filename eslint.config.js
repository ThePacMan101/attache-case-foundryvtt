import js from "@eslint/js";
import globals from "globals";

const FOUNDRY_GLOBALS = [
  "foundry", "game", "ui", "CONFIG", "Hooks", "Actor", "Item", "canvas", "fromUuid", "CONST"
];

export default [
  {
    ignores: ["node_modules/**", "packs/**", "dev/data/**", "dev/cache/**", "dev/artifacts/**", "coverage/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...Object.fromEntries(FOUNDRY_GLOBALS.map((name) => [name, "readonly"]))
      }
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      semi: ["error", "always"],
      quotes: ["error", "double", { avoidEscape: true }]
    }
  },
  {
    // The core must run in plain Node: forbid Foundry globals there.
    files: ["scripts/core/**"],
    rules: {
      "no-restricted-globals": ["error", ...FOUNDRY_GLOBALS]
    }
  }
];
