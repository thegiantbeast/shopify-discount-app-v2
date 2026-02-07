/**
 * Shopify admin navigation helpers.
 */

/**
 * Clicks a sidebar link by label text.
 * @param {import('@playwright/test').Page} page
 * @param {RegExp|string} label
 */
export async function clickSidebarLink(page, label) {
  const link = page.getByRole("link", { name: label });
  await link.waitFor({ state: "visible", timeout: 60_000 });
  await link.click({ force: true });
}
