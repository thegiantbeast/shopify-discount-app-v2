/**
 * Embedded app iframe helpers.
 */

/**
 * Returns a FrameLocator for the Shopify embedded app iframe.
 * @param {import('@playwright/test').Page} page
 * @param {string} [iframeName='app-iframe']
 * @returns {import('@playwright/test').FrameLocator}
 */
export function waitForEmbeddedAppFrame(page, iframeName = "app-iframe") {
  const iframe = page.locator(`iframe[name="${iframeName}"]`);
  const iframeContent = iframe.contentFrame();
  if (!iframeContent) {
    throw new Error(
      `Iframe "${iframeName}" was found but no frame context is available.`,
    );
  }
  return iframeContent;
}
