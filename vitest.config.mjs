import { defineConfig } from "vitest/config";

// Only unit tests; Playwright E2E specs under dev/ are run separately.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.mjs"],
    environment: "node"
  }
});
