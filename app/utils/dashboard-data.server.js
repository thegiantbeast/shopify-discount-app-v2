import { createLogger } from "./logger.server.js";
import { getShopTierInfo } from "./tier-manager.server.js";

const logger = createLogger("DashboardData");

// Manual task definitions that can be toggled by the merchant
export const MANUAL_TASK_DEFINITIONS = {
  "Enable embed block": {
    description:
      "Enable the discount embed block to display discounts on your product pages.",
    buttonText: "Open Theme Editor",
    buttonUrl: "https://admin.shopify.com/themes/current/editor?context=apps",
    target: "_blank",
    order: 3,
  },
  "Customize appearance (optional)": {
    description:
      "Adjust colors, text, and styling to match your brand and create a consistent shopping experience.",
    buttonText: "Open Settings",
    buttonUrl: "/app/settings",
    order: 4,
  },
};

/**
 * Aggregate dashboard stats: tier info, discount counts, manual task statuses.
 */
export async function loadDashboardData(shopDomain, db) {
  const [tierInfo, totalDiscountCount, liveDiscountCount, manualTaskStatuses] =
    await Promise.all([
      getShopTierInfo(shopDomain, db),
      db.liveDiscount.count({ where: { shop: shopDomain } }),
      db.liveDiscount.count({ where: { shop: shopDomain, status: "LIVE" } }),
      getManualTaskStatuses(shopDomain, db),
    ]);

  return { tierInfo, totalDiscountCount, liveDiscountCount, manualTaskStatuses };
}

/**
 * Read completion state of manual setup tasks from SetupTask table.
 */
export async function getManualTaskStatuses(shopDomain, db) {
  const tasks = await db.setupTask.findMany({
    where: { shop: shopDomain, isManual: true },
    select: { title: true, isCompleted: true },
  });

  const statuses = {};
  for (const title of Object.keys(MANUAL_TASK_DEFINITIONS)) {
    const task = tasks.find((t) => t.title === title);
    statuses[title] = task?.isCompleted || false;
  }

  return statuses;
}

/**
 * Upsert a manual setup task's completion state.
 */
export async function updateManualTaskStatus(
  shopDomain,
  taskTitle,
  completed,
  db,
) {
  const definition = MANUAL_TASK_DEFINITIONS[taskTitle];
  if (!definition) {
    throw new Error(`Unknown manual task: ${taskTitle}`);
  }

  const shop = await db.shop.findUnique({
    where: { domain: shopDomain },
    select: { id: true },
  });

  if (!shop) {
    throw new Error(`Shop not found: ${shopDomain}`);
  }

  await db.setupTask.upsert({
    where: { shop_title: { shop: shopDomain, title: taskTitle } },
    update: { isCompleted: completed },
    create: {
      shop: shopDomain,
      shopId: shop.id,
      title: taskTitle,
      description: definition.description,
      buttonText: definition.buttonText,
      buttonUrl: definition.buttonUrl,
      target: definition.target || null,
      isManual: true,
      isCompleted: completed,
      order: definition.order,
    },
  });

  return getManualTaskStatuses(shopDomain, db);
}

/**
 * Check whether the theme app extension embed block is enabled in the active theme.
 * Returns { checked: boolean, enabled: boolean }.
 * If unable to check, returns { checked: false, enabled: false }.
 */
export async function getEmbedBlockStatus(admin) {
  try {
    const response = await admin.graphql(`
      query GetMainTheme {
        themes(first: 1, roles: MAIN) {
          nodes {
            id
            name
          }
        }
      }
    `);
    const data = await response.json();
    const theme = data.data?.themes?.nodes?.[0];

    if (!theme) {
      return { checked: false, enabled: false };
    }

    const settingsResponse = await admin.graphql(
      `
      query GetThemeSettings($themeId: ID!) {
        theme(id: $themeId) {
          files(filenames: ["config/settings_data.json"], first: 1) {
            nodes {
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
          }
        }
      }
    `,
      { variables: { themeId: theme.id } },
    );
    const settingsData = await settingsResponse.json();
    const fileContent =
      settingsData.data?.theme?.files?.nodes?.[0]?.body?.content;

    if (!fileContent) {
      return { checked: false, enabled: false };
    }

    const settings = JSON.parse(fileContent);
    const blocks = settings?.current?.blocks || {};

    // Look for our app's embed block (not disabled)
    const isEnabled = Object.values(blocks).some(
      (block) =>
        block.type?.includes("discounts-display-pro") && !block.disabled,
    );

    return { checked: true, enabled: isEnabled };
  } catch (error) {
    logger.debug("Could not check embed block status", { err: error });
    return { checked: false, enabled: false };
  }
}
