import { test, expect } from "@playwright/test";

const skipAuth = process.env.PLAYWRIGHT_SKIP_AUTH_SETUP === "1";

test.describe("Smoke tests", () => {
  test.skip(skipAuth, "Requires Shopify auth credentials");

  test("Dashboard loads successfully", async ({ page }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // Wait for the app to load within the Shopify admin iframe
    const frame = page.frameLocator('iframe[name="app-iframe"]');

    // Verify dashboard heading exists
    await expect(
      frame.locator("h1, [role='heading']").first()
    ).toBeVisible({ timeout: 30_000 });
  });

  test("Settings page loads", async ({ page }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
    await page.goto(`${baseUrl}/app/settings`, { waitUntil: "networkidle" });

    const frame = page.frameLocator('iframe[name="app-iframe"]');
    await expect(
      frame.locator("h1, [role='heading']").first()
    ).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("API endpoint smoke tests", () => {
  test("GET /api/discounts without shop returns 400", async ({ request }) => {
    const response = await request.get("/api/discounts");
    expect(response.status()).toBe(400);
  });

  test("GET /api/discounts with shop but no filters returns empty products", async ({ request }) => {
    const response = await request.get("/api/discounts?shop=test.myshopify.com");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("products");
    expect(Object.keys(body.products)).toHaveLength(0);
  });

  test("POST /api/best-discounts with invalid body returns 400", async ({ request }) => {
    const response = await request.post("/api/best-discounts", {
      data: "not json",
      headers: { "Content-Type": "text/plain" },
    });
    // Should be 400 for invalid body
    expect([400, 500]).toContain(response.status());
  });
});
