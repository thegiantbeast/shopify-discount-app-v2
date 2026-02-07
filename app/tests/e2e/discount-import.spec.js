import { test, expect } from "@playwright/test";
import { buildPreviewUrl, buildAdminUrl } from "./utils/shopify-preview.js";
import { waitForEmbeddedAppFrame } from "./helpers/frames.js";
import { clickSidebarLink } from "./helpers/navigation.js";

const TITLE_CELL_SELECTOR =
  'td[class^="_TitleCell"], td[class*=" _TitleCell"], td[class*="_TitleCell_"]';
const STATUS_CELL_SELECTOR =
  'td[class^="_StatusItem"], td[class*=" _StatusItem"], td[class*="_StatusItem_"]';
const TITLE_TEXT_SELECTOR =
  '[class^="_TitleContent"], [class*=" _TitleContent"], [class*="_TitleContent_"]';
const STATUS_TEXT_SELECTOR =
  '[class^="_StatusItem"], [class*=" _StatusItem"], [class*="_StatusItem_"]';

const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();

const normalizeStatus = (value) =>
  normalize(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\binfo\b/gi, "")
    .replace(/\battention\b/gi, "")
    .replace(/\bdiscount status\b/gi, "")
    .replace(/\bdiscount code status\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const isTitleValid = (title) => /\bvalid\b/i.test(title);
const isTitleInvalid = (title) => /\binvalid\b/i.test(title);
const isTitleScheduled = (title) => /\bscheduled\b/i.test(title);
const isTitleExpired = (title) => /\bexpired\b/i.test(title);

async function readAdminDiscountRows(context) {
  const adminPage = await context.newPage();
  try {
    const adminDiscountUrl = `${buildAdminUrl("/discounts")}?locale=en`;
    await adminPage.goto(adminDiscountUrl, { waitUntil: "domcontentloaded" });

    const loadingSelector = ".Polaris-IndexTable__LoadingPanelText";
    await adminPage
      .locator(loadingSelector)
      .waitFor({ state: "detached", timeout: 30_000 })
      .catch(() => undefined);

    const tableRows = adminPage.locator(
      "table.Polaris-IndexTable__Table tbody tr",
    );
    await tableRows.first().waitFor({ timeout: 20_000 }).catch(() => undefined);

    const rows = await tableRows.evaluateAll((rows) =>
      rows
        .map((row) => {
          const titleCell =
            row.querySelector(
              '[class^="_TitleCell"], [class*=" _TitleCell"], [class*="_TitleCell_"]',
            ) || row;
          const statusCell =
            row.querySelector(
              '[class^="_StatusItem"], [class*=" _StatusItem"], [class*="_StatusItem_"]',
            ) || row;

          const titleNode =
            titleCell.querySelector(
              '[class^="_TitleContent"], [class*=" _TitleContent"], [class*="_TitleContent_"]',
            ) ||
            titleCell.querySelector("h3") ||
            titleCell;

          const statusNode =
            statusCell.querySelector(
              '[class^="_StatusItem"], [class*=" _StatusItem"], [class*="_StatusItem_"]',
            ) || statusCell;

          const title = (titleNode?.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          const status = (statusNode?.textContent || "")
            .replace(/\s+/g, " ")
            .trim();

          if (!title) return null;
          return { title, status };
        })
        .filter((row) => !!row),
    );

    return rows.map((row) => ({
      title: normalize(row.title),
      status: normalizeStatus(row.status),
    }));
  } finally {
    await adminPage.close();
  }
}

async function readAppDiscountRows(
  page,
  timeoutMs = 120_000,
  pollInterval = 2_000,
) {
  await clickSidebarLink(page, /manage discounts/i);
  const frame = waitForEmbeddedAppFrame(page);

  await frame
    .getByRole("heading", { name: /manage your discounts/i })
    .first()
    .waitFor({ timeout: 30_000 });

  const loadingSelector = ".Polaris-IndexTable__LoadingPanelText";
  await frame
    .locator(loadingSelector)
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => undefined);
  await frame
    .locator(loadingSelector)
    .waitFor({ state: "detached", timeout: 30_000 })
    .catch(() => undefined);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rowsLocator = frame.locator(
      "table.Polaris-IndexTable__Table tbody tr",
    );
    const count = await rowsLocator.count();

    if (count > 0) {
      const rawRows = await rowsLocator.evaluateAll(
        (rows, selectors) => {
          const {
            titleCellSelector,
            statusCellSelector,
            titleTextSelector,
            statusTextSelector,
          } = selectors;

          const results = [];
          for (const row of rows) {
            const titleCell =
              row.querySelector(titleCellSelector) ||
              row.querySelector("td:nth-of-type(2)") ||
              row.querySelector('th[scope="row"]') ||
              row;
            const statusCell =
              row.querySelector(statusCellSelector) ||
              row.querySelector("td:last-child") ||
              row;

            const titleNode =
              (titleCell && titleCell.querySelector(titleTextSelector)) ||
              (titleCell && titleCell.querySelector("h1, h2, h3, h4")) ||
              titleCell;

            const statusNode =
              (statusCell && statusCell.querySelector(statusTextSelector)) ||
              (statusCell &&
                statusCell.querySelector("h1, h2, h3, h4, span, div")) ||
              statusCell;

            const titleText =
              titleNode && titleNode.textContent ? titleNode.textContent : "";
            const statusText =
              statusNode && statusNode.textContent
                ? statusNode.textContent
                : "";

            const title = titleText.replace(/\s+/g, " ").trim();
            let status = statusText
              .replace(/\s+/g, " ")
              .replace(/([a-z])([A-Z])/g, "$1 $2")
              .trim();

            const cellTexts = Array.from(row.querySelectorAll("th, td"))
              .map((cell) =>
                (cell.textContent || "")
                  .replace(/\s+/g, " ")
                  .replace(/([a-z])([A-Z])/g, "$1 $2")
                  .trim(),
              )
              .filter(
                (text) =>
                  !!text &&
                  !/^select discount$/i.test(text) &&
                  !text.startsWith("Select discount ") &&
                  !text.includes(title),
              );

            const statusPriority = [
              /\bscheduled\b/i,
              /\binactive\b/i,
              /\bactive\b/i,
              /\bhidden\b/i,
              /\blive\b/i,
              /\bexpired\b/i,
              /\bdraft\b/i,
              /\bpaused\b/i,
              /\bcancelled\b/i,
            ];

            for (const keyword of statusPriority) {
              const match = cellTexts.find((text) => keyword.test(text));
              if (match) {
                status = match;
                if (/\bscheduled\b/i.test(match)) {
                  break;
                }
              }
            }

            if (!title || /^select discount$/i.test(title)) {
              continue;
            }

            results.push({ title, status });
          }

          return results;
        },
        {
          titleCellSelector: TITLE_CELL_SELECTOR,
          statusCellSelector: STATUS_CELL_SELECTOR,
          titleTextSelector: TITLE_TEXT_SELECTOR,
          statusTextSelector: STATUS_TEXT_SELECTOR,
        },
      );

      const normalizedRows = rawRows
        .map((row) => {
          const title = normalize(row.title);
          if (!title) return null;

          const status = normalizeStatus(row.status);
          return { title, status, isScheduled: /scheduled/i.test(status) };
        })
        .filter((row) => row !== null);

      if (normalizedRows.length > 0) {
        return normalizedRows;
      }
    }

    const emptyVisible = await frame
      .locator("text=/no discounts found/i")
      .isVisible()
      .catch(() => false);
    if (emptyVisible) return [];

    await page.waitForTimeout(pollInterval);
  }

  return [];
}

function createDiscountBuckets(rows) {
  return rows.reduce(
    (acc, row) => {
      const titleNorm = normalize(row.title);
      if (isTitleInvalid(titleNorm)) {
        acc.invalid.push(row);
      } else if (isTitleValid(titleNorm)) {
        if (isTitleExpired(titleNorm) || /expired|ended/i.test(row.status)) {
          acc.validExpired.push(row);
        } else if (
          isTitleScheduled(titleNorm) ||
          /scheduled/i.test(row.status)
        ) {
          acc.validScheduled.push(row);
        } else {
          acc.validActive.push(row);
        }
      }
      return acc;
    },
    { validActive: [], validScheduled: [], validExpired: [], invalid: [] },
  );
}

function createAppLookup(rows) {
  const map = new Map();
  rows.forEach((row) => map.set(normalize(row.title), row));
  return map;
}

function assertRowPresence(appRowsMap, rows, behavior) {
  rows.forEach((row) => {
    const key = normalize(row.title);
    const appRow = appRowsMap.get(key);
    if (behavior === "present") {
      expect(
        appRow,
        `Expected discount "${row.title}" to appear in Manage Discounts.`,
      ).toBeTruthy();
    } else if (behavior === "scheduled") {
      expect(
        appRow,
        `Expected scheduled discount "${row.title}" to appear in Manage Discounts.`,
      ).toBeTruthy();
      expect(
        appRow?.isScheduled,
        `Expected discount "${row.title}" to display the Scheduled badge.`,
      ).toBe(true);
    } else {
      expect(
        appRow,
        `Expected discount "${row.title}" to be excluded from Manage Discounts.`,
      ).toBeUndefined();
    }
  });
}

test.describe("Discount import parity", () => {
  test("eligible discounts sync to Manage Discounts with correct states", async ({
    page,
  }) => {
    const previewUrl = buildPreviewUrl();

    await page.goto(previewUrl, { waitUntil: "domcontentloaded" });

    const adminRows = await readAdminDiscountRows(page.context());
    console.log("Admin rows:", adminRows);

    await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
    const appRows = await readAppDiscountRows(page);
    console.log("App rows:", appRows);

    const adminBuckets = createDiscountBuckets(adminRows);
    const appLookup = createAppLookup(appRows);

    // Active valid discounts must be present
    assertRowPresence(appLookup, adminBuckets.validActive, "present");

    // Scheduled valid discounts must be present and flagged
    assertRowPresence(appLookup, adminBuckets.validScheduled, "scheduled");

    // Expired valid discounts must be absent
    assertRowPresence(appLookup, adminBuckets.validExpired, "absent");

    // Invalid discounts should never appear
    assertRowPresence(appLookup, adminBuckets.invalid, "absent");

    // Verify onboarding checklist state
    await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
    const appFrame = waitForEmbeddedAppFrame(page);

    await appFrame
      .getByRole("heading", { name: /setup guide/i })
      .waitFor({ timeout: 30_000 });

    const firstTaskButton = appFrame.getByRole("button", {
      name: /mark create your first discount as done/i,
    });
    const completedIcon = firstTaskButton.locator("svg circle");

    if (
      adminBuckets.validActive.length +
        adminBuckets.validScheduled.length +
        adminBuckets.validExpired.length >
      0
    ) {
      await expect(completedIcon).toHaveCount(1);
    } else {
      await expect(completedIcon).toHaveCount(0);
    }
  });
});
