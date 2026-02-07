/**
 * Shopify login automation for E2E tests.
 */

const SHOPIFY_LOGIN_EMAIL = process.env.SHOPIFY_EMAIL;
const SHOPIFY_LOGIN_PASSWORD = process.env.SHOPIFY_PASSWORD;

/**
 * Handles Shopify login if the current page requires authentication.
 * Supports both dedicated login pages and inline login forms.
 * @param {import('@playwright/test').Page} page
 */
export async function loginToShopifyIfNeeded(page) {
  const loginPatterns = [/accounts\.shopify\.com/i, /\/account/i, /\/login/i];
  const currentUrl = page.url();

  const shouldCheckInline = !loginPatterns.some((pattern) =>
    pattern.test(currentUrl),
  );
  if (shouldCheckInline) {
    const inlineEmailField = page.locator(
      'input[name="account[email]"], input#account_email',
    );
    if ((await inlineEmailField.count()) === 0) {
      return;
    }
  }

  if (!SHOPIFY_LOGIN_EMAIL || !SHOPIFY_LOGIN_PASSWORD) {
    throw new Error(
      "SHOPIFY_EMAIL and SHOPIFY_PASSWORD must be set to automate Shopify login.",
    );
  }

  // Phase 1: Email
  const emailField = page.locator(
    'input[name="account[email]"], input#account_email',
  );
  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(SHOPIFY_LOGIN_EMAIL);
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

  // Phase 2: Password
  const passwordField = page.locator(
    'input[name="account[password]"], input#account_password',
  );
  if (await passwordField.isVisible().catch(() => false)) {
    await passwordField.fill(SHOPIFY_LOGIN_PASSWORD);
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

  await page.waitForLoadState("domcontentloaded");
}
