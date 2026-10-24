import { defineConfig } from "@playwright/test";

// One Foundry server serves one active world at a time, so specs run serially.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs$/,
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "../artifacts/test-results",
  use: {
    viewport: { width: 1600, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
