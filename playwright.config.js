import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";

dotenv.config();

const skipAuth = process.env.PLAYWRIGHT_SKIP_AUTH_SETUP === "1";
const storageStatePath =
  process.env.PLAYWRIGHT_STORAGE_STATE || "playwright/.auth/shopify.json";
const deviceProfile = devices["Desktop Chrome HiDPI"] ?? devices["Desktop Chrome"];

export default defineConfig({
  testDir: "./app/tests/e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { open: "never" }]],
  snapshotPathTemplate: "{testDir}/regressions/screenshots/{arg}{ext}",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    ...(skipAuth ? {} : { storageState: storageStatePath }),
  },

  ...(skipAuth
    ? {}
    : {
        globalSetup: "./app/tests/e2e/global-setup.js",
      }),

  projects: [
    {
      name: "chromium",
      use: {
        ...deviceProfile,
        viewport: { width: 1600, height: 900 },
        deviceScaleFactor: 2,
      },
    },
  ],
});
