/**
 * Playwright global setup.
 * Handles Shopify embedded app authentication.
 * Skip with PLAYWRIGHT_SKIP_AUTH_SETUP=1 for CI without credentials.
 *
 * Reuses existing storage state if present on disk.
 * Delete playwright/.auth/shopify.json to force re-authentication.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const AUTH_STATE_PATH =
  process.env.PLAYWRIGHT_STORAGE_STATE ||
  path.resolve(process.cwd(), "playwright/.auth/shopify.json");

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export default async function globalSetup() {
  const skipAuth = process.env.PLAYWRIGHT_SKIP_AUTH_SETUP === "1";
  if (skipAuth) {
    console.log("[global-setup] Skipping auth (PLAYWRIGHT_SKIP_AUTH_SETUP=1)");
    ensureDir(AUTH_STATE_PATH);
    fs.writeFileSync(
      AUTH_STATE_PATH,
      JSON.stringify({ cookies: [], origins: [] }),
    );
    return;
  }

  // Reuse cached storage state if it exists
  if (fs.existsSync(AUTH_STATE_PATH)) {
    console.log(
      `[global-setup] Reusing existing storage state at ${AUTH_STATE_PATH}`,
    );
    return;
  }

  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const email = process.env.SHOPIFY_EMAIL;
  const password = process.env.SHOPIFY_PASSWORD;

  if (!shopDomain) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN environment variable");
  }
  if (!email || !password) {
    throw new Error(
      "Missing SHOPIFY_EMAIL or SHOPIFY_PASSWORD for auth setup",
    );
  }

  const isCI = process.env.CI === "true" || process.env.CI === "1";
  const headless =
    process.env.PLAYWRIGHT_GLOBAL_SETUP_HEADLESS === "true" || isCI;

  console.log("[global-setup] Starting Shopify authentication...");

  const browser = await chromium.launch({ headless });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to Shopify admin
    await page.goto(`https://${shopDomain}/admin/apps`, {
      waitUntil: "domcontentloaded",
    });

    // Two-phase login: email → continue/next → password → submit
    const emailField = page.locator(
      'input[name="account[email]"], input#account_email',
    );
    if (await emailField.isVisible().catch(() => false)) {
      await emailField.fill(email);

      const continueButton = page
        .locator(
          'button[type="submit"], button:has-text("Next"), button:has-text("Continue")',
        )
        .first();
      if (await continueButton.isVisible().catch(() => false)) {
        await Promise.all([
          page.waitForLoadState("domcontentloaded"),
          continueButton.click(),
        ]).catch(() => undefined);
      } else {
        await page.keyboard.press("Enter");
        await page.waitForLoadState("domcontentloaded");
      }
    }

    const passwordField = page.locator(
      'input[name="account[password]"], input#account_password',
    );
    if (await passwordField.isVisible().catch(() => false)) {
      await passwordField.fill(password);

      const submitButton = page
        .locator(
          'button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")',
        )
        .first();
      await Promise.all([
        page.waitForLoadState("domcontentloaded"),
        submitButton.click(),
      ]).catch(() => undefined);
    }

    await page.waitForURL("**/admin/**", { timeout: 30_000 });

    // Save auth state
    ensureDir(AUTH_STATE_PATH);
    await context.storageState({ path: AUTH_STATE_PATH });
    console.log(`[global-setup] Auth state saved to ${AUTH_STATE_PATH}`);
  } finally {
    await browser.close();
  }
}
