/**
 * Visual regression test helpers.
 * Loads targets from urls.json, resolves CSS selectors, prepares pages for screenshots.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegressionScenario } from "./scenarios.js";
import {
  getThemeSelectors,
  getFallbackSelectors,
} from "../../../utils/theme-selectors.server.js";

const REGRESSION_CONFIG_RELATIVE_PATH =
  "app/tests/e2e/regressions/urls.json";
const DEFAULT_STOREFRONT_PASSWORD =
  process.env.SHOPIFY_STOREFRONT_PASSWORD ??
  process.env.STOREFRONT_PASSWORD ??
  null;

export const REGRESSION_CONFIG_PATH = path.resolve(
  process.cwd(),
  REGRESSION_CONFIG_RELATIVE_PATH,
);

/**
 * Loads regression targets synchronously from urls.json.
 * @returns {Array<object>}
 */
export function loadRegressionTargetsSync() {
  const fileContents = readFileSync(REGRESSION_CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(fileContents);
  return buildTargetsFromConfig(parsed);
}

function buildTargetsFromConfig(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Regression config at ${REGRESSION_CONFIG_PATH} is malformed.`,
    );
  }

  const targets = [];

  for (const [theme, themeConfig] of Object.entries(parsed)) {
    // Skip comment entries (string values used as hints in JSON)
    if (typeof themeConfig === "string") continue;

    if (!themeConfig || typeof themeConfig !== "object") {
      throw new Error(
        `Theme entry "${theme}" is not an object in regression config.`,
      );
    }

    if (!Array.isArray(themeConfig.pages) || themeConfig.pages.length === 0) {
      throw new Error(
        `Theme "${theme}" must define a non-empty "pages" array in regression config.`,
      );
    }

    for (const pageConfig of themeConfig.pages) {
      validatePageConfig(theme, pageConfig, themeConfig.previewUrl);

      const baselineBaseName = normalizeBaselineBaseName(pageConfig.baseline);
      const snapshotName = `${path.posix.join(theme, baselineBaseName)}.png`;
      const baselineFileName = `${baselineBaseName}.png`;
      const url = resolvePageUrl(theme, pageConfig, themeConfig.previewUrl);
      const password = normalizePassword(
        themeConfig.password ?? DEFAULT_STOREFRONT_PASSWORD,
      );
      const scenarioName = normalizeScenarioName(pageConfig.scenario);
      const maxDiffPixels = normalizeNonNegativeNumber(
        pageConfig.maxDiffPixels,
      );
      const maxDiffPixelRatio = normalizeNonNegativeNumber(
        pageConfig.maxDiffPixelRatio,
      );
      const ignoreBottomPx = normalizeNonNegativeNumber(
        pageConfig.ignoreBottomPx,
      );
      const explicitSnapshotSelector = normalizeSelector(
        pageConfig.snapshotSelector,
      );
      const snapshotTarget = normalizeSnapshotTarget(
        pageConfig.snapshotTarget,
      );
      const snapshotSelector = resolveSnapshotSelector(
        theme,
        explicitSnapshotSelector,
        snapshotTarget,
      );

      targets.push({
        theme,
        url,
        snapshotName,
        baselineFileName,
        password,
        scenarioName,
        maxDiffPixels,
        maxDiffPixelRatio,
        ignoreBottomPx,
        snapshotSelector,
        snapshotTarget,
      });
    }
  }

  return targets;
}

/**
 * Prepares a page for clean screenshots.
 * Disables animations, hides scrollbars, masks preview bar.
 * @param {import('@playwright/test').Page} page
 * @param {object} [target]
 */
export async function preparePageForScreenshot(page, target) {
  await dismissShopifyPreviewBar(page);
  if (target?.ignoreBottomPx && !target.snapshotSelector) {
    await applyBottomMask(page, target.ignoreBottomPx);
  }
  await page
    .addStyleTag({
      content: `
      *, *::before, *::after {
        transition-duration: 0s !important;
        animation-duration: 0s !important;
        animation-iteration-count: 1 !important;
        animation-delay: 0s !important;
      }

      [data-visual-regression-mask="true"] {
        visibility: hidden !important;
      }

      html, body {
        overflow: hidden !important;
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }

      html::-webkit-scrollbar,
      body::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
        background: transparent !important;
      }

      ::selection {
        background: transparent !important;
      }

      *, *::before, *::after {
        caret-color: transparent !important;
      }

      #preview-bar-iframe,
      iframe#preview-bar-iframe,
      iframe#preview-bar-iframe + *,
      .shopify-preview-bar,
      .shopify-preview-bar__container,
      .shopify-preview-bar__inner,
      .preview-bar {
        display: none !important;
        visibility: hidden !important;
      }
    `,
    })
    .catch(() => undefined);

  await page
    .evaluate(() => {
      const iframe = document.getElementById("preview-bar-iframe");
      if (iframe instanceof HTMLElement) {
        iframe.style.display = "none";
        iframe.style.visibility = "hidden";
      }

      document.body.style.setProperty("padding-bottom", "0px", "important");
      document.body.style.setProperty("margin-bottom", "0px", "important");
      document.documentElement.style.setProperty(
        "padding-bottom",
        "0px",
        "important",
      );
      document.documentElement.style.setProperty(
        "margin-bottom",
        "0px",
        "important",
      );
    })
    .catch(() => undefined);

  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(200);
}

/**
 * Unlocks the storefront password page if present.
 * @param {import('@playwright/test').Page} page
 * @param {string} [password]
 * @returns {Promise<boolean>} true if password was entered
 */
export async function unlockStorefrontIfNeeded(page, password) {
  const storefrontPassword = normalizePassword(password);
  if (!storefrontPassword) {
    return false;
  }

  const passwordInput = page
    .locator(
      'input[type="password"], input[name="password"], input#Password, input#password',
    )
    .first();

  const heading = page.locator("text=/enter store using password/i");

  const isPasswordGateVisible =
    (await passwordInput.isVisible().catch(() => false)) ||
    (await heading.isVisible().catch(() => false)) ||
    page.url().includes("/password");

  if (!isPasswordGateVisible) {
    return false;
  }

  if (!(await passwordInput.isVisible().catch(() => false))) {
    await page.waitForTimeout(100);
  }

  if (!(await passwordInput.isVisible().catch(() => false))) {
    return false;
  }

  await passwordInput.fill(storefrontPassword);

  const submitButton = page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Enter"), button:has-text("Submit"), button:has-text("Access store")',
    )
    .first();

  if (await submitButton.isVisible().catch(() => false)) {
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded" })
        .catch(() => undefined),
      submitButton.click(),
    ]);
  } else {
    await page.keyboard.press("Enter");
    await page
      .waitForNavigation({ waitUntil: "domcontentloaded" })
      .catch(() => undefined);
  }

  await page.waitForLoadState("networkidle").catch(() => undefined);

  return true;
}

/**
 * Resolves a scenario function for a regression target.
 * @param {object} target
 * @returns {((page: import('@playwright/test').Page) => Promise<void>)|undefined}
 */
export function resolveScenario(target) {
  if (!target.scenarioName) {
    return undefined;
  }

  return getRegressionScenario(target.scenarioName);
}

// --- Internal helpers ---

function validatePageConfig(theme, pageConfig, previewUrl) {
  if (!pageConfig || typeof pageConfig !== "object") {
    throw new Error(
      `Theme "${theme}" has an invalid page entry in regression config.`,
    );
  }

  if (!pageConfig.baseline) {
    throw new Error(
      `Theme "${theme}" defines a page without a "baseline" name.`,
    );
  }

  const hasUrl =
    typeof pageConfig.url === "string" && pageConfig.url.length > 0;
  const hasPath =
    typeof pageConfig.path === "string" && pageConfig.path.length > 0;

  if (!hasUrl && !hasPath) {
    throw new Error(
      `Theme "${theme}" page "${pageConfig.baseline}" must define either "url" or "path".`,
    );
  }

  if (hasPath && !previewUrl) {
    throw new Error(
      `Theme "${theme}" page "${pageConfig.baseline}" defines a "path" but theme is missing "previewUrl".`,
    );
  }
}

function normalizeBaselineBaseName(baseline) {
  const normalized = baseline.replace(/\\/g, "/").replace(/^\/*/, "");

  if (!normalized) {
    throw new Error("Baseline names must not be empty.");
  }

  if (normalized.includes("..")) {
    throw new Error(
      `Baseline name "${baseline}" must not contain ".." segments.`,
    );
  }

  const withoutExtension = normalized.toLowerCase().endsWith(".png")
    ? normalized.slice(0, -4)
    : normalized;

  if (!withoutExtension) {
    throw new Error(
      `Baseline name "${baseline}" must resolve to a non-empty file stem.`,
    );
  }

  return withoutExtension;
}

function resolvePageUrl(theme, pageConfig, previewUrl) {
  if (pageConfig.url) {
    return pageConfig.url;
  }

  if (!previewUrl) {
    throw new Error(
      `Theme "${theme}" cannot resolve page URL without a "previewUrl".`,
    );
  }

  const url = new URL(previewUrl);

  const rawPath = pageConfig.path ?? "";
  const [pathPart, searchPart] = rawPath.split("?");
  url.pathname = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;

  if (searchPart) {
    const overrides = new URLSearchParams(searchPart);
    overrides.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
}

function normalizePassword(password) {
  if (!password) return undefined;
  const trimmed = String(password).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeScenarioName(name) {
  if (!name) return undefined;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNonNegativeNumber(input) {
  if (input === undefined) return undefined;
  if (!Number.isFinite(input) || input < 0) {
    throw new Error(
      "Snapshot tolerance values must be non-negative finite numbers.",
    );
  }
  return input;
}

function normalizeSelector(selector) {
  if (!selector) return undefined;
  const trimmed = selector.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSnapshotTarget(target) {
  if (target === undefined || target === null) return undefined;
  const normalized = `${target}`.trim().toLowerCase();
  if (!normalized) return undefined;

  if (normalized === "card" || normalized === "form") {
    return normalized;
  }

  throw new Error(
    `Unsupported snapshotTarget value "${target}". Use "card" or "form".`,
  );
}

function resolveSnapshotSelector(
  theme,
  explicitSelector,
  snapshotTarget,
) {
  if (explicitSelector) {
    return explicitSelector;
  }

  if (!snapshotTarget) {
    return undefined;
  }

  const key =
    snapshotTarget === "card" ? "cardContainer" : "formContainer";
  const themeSelectors = getThemeSelectors(theme);
  const selectorFromTheme = themeSelectors ? themeSelectors[key] : undefined;

  if (selectorFromTheme) {
    return normalizeSelector(selectorFromTheme) ?? undefined;
  }

  const fallbackSelectors = getFallbackSelectors();
  const fallbackSelector = fallbackSelectors
    ? fallbackSelectors[key]
    : undefined;
  if (fallbackSelector) {
    return normalizeSelector(fallbackSelector) ?? undefined;
  }

  throw new Error(
    `Unable to resolve snapshot selector for theme "${theme}" target "${snapshotTarget}".`,
  );
}

async function dismissShopifyPreviewBar(page) {
  try {
    await page.waitForTimeout(100);

    const frameLocator = page.frameLocator?.("#preview-bar-iframe");
    if (!frameLocator) return;

    const hideButton = frameLocator
      .locator(
        'button:has-text("Hide"), button[aria-label*="Hide"], [data-action="hide"], button[aria-label*="Close"]',
      )
      .first();

    if (await hideButton.isVisible().catch(() => false)) {
      await hideButton.click().catch(() => undefined);
      await page.waitForTimeout(300);
    }
  } catch {
    // ignore failures, CSS masking will still apply
  }
}

async function applyBottomMask(page, bottomPixels) {
  if (!bottomPixels || bottomPixels <= 0) {
    return;
  }

  await page
    .evaluate((height) => {
      const existing = document.getElementById(
        "__visual-regression-bottom-mask__",
      );
      if (existing?.parentElement) {
        existing.remove();
      }

      const mask = document.createElement("div");
      mask.id = "__visual-regression-bottom-mask__";
      mask.style.position = "fixed";
      mask.style.left = "0";
      mask.style.right = "0";
      mask.style.bottom = "0";
      mask.style.height = `${height}px`;
      mask.style.zIndex = "2147483647";
      mask.style.pointerEvents = "none";
      mask.style.background =
        getComputedStyle(document.body).backgroundColor || "#ffffff";
      document.body.appendChild(mask);
    }, bottomPixels)
    .catch(() => undefined);
}
