import { json } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useRevalidator,
} from "@remix-run/react";
import { useEffect, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  Banner,
  Button,
  BlockStack,
  InlineStack,
  ProgressBar,
  Badge,
  Icon,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { getAvailableTiers } from "../utils/tier-manager.js";
import { HELP_URL, SUPPORT_EMAIL } from "../utils/constants.js";

// Static task definitions — used by both server (loader/action) and client (component).
// Defined here rather than imported from a .server.js file to avoid client bundle issues.
const MANUAL_TASK_DEFINITIONS = {
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

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { createLogger } = await import("../utils/logger.server.js");
  const prisma = (await import("../db.server.js")).default;
  const { loadDashboardData, getEmbedBlockStatus } = await import(
    "../utils/dashboard-data.server.js"
  );

  const logger = createLogger("IndexPage");
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  logger.info("Dashboard loader", { shop: shopDomain });

  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    select: { installStatus: true },
  });

  const [dashboardData, embedBlockStatus] = await Promise.all([
    loadDashboardData(shopDomain, prisma),
    getEmbedBlockStatus(admin),
  ]);

  const { readFile } = await import("fs/promises");
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf-8")
  );

  return json({
    ...dashboardData,
    availableTiers: getAvailableTiers(),
    shop: shopDomain,
    discountCount: dashboardData.liveDiscountCount,
    embedBlockStatus,
    showDevTools: process.env.SHOW_DASHBOARD_DEV_TOOLS === "true",
    installStatus: shop?.installStatus || null,
    appVersion: pkg.version,
  });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { createLogger } = await import("../utils/logger.server.js");
  const prisma = (await import("../db.server.js")).default;
  const { updateManualTaskStatus, MANUAL_TASK_DEFINITIONS: taskDefs } =
    await import("../utils/dashboard-data.server.js");

  const logger = createLogger("IndexPage");
  const { session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  const formData = await request.formData();
  const taskTitle = formData.get("taskTitle");
  const completed = formData.get("completed") === "true";

  if (!taskDefs[taskTitle]) {
    return json({ error: "Invalid task" }, { status: 400 });
  }

  try {
    const statuses = await updateManualTaskStatus(
      shopDomain,
      taskTitle,
      completed,
      prisma,
    );
    return json({ manualTaskStatuses: statuses });
  } catch (error) {
    logger.error("Failed to update task", { err: error, shop: shopDomain });
    return json({ error: "Failed to update task" }, { status: 500 });
  }
};

function TaskItem({
  title,
  description,
  completed,
  onToggle,
  buttonText,
  buttonUrl,
  target,
}) {
  return (
    <InlineStack gap="300" align="start" blockAlign="start" wrap={false}>
      <div
        style={{
          cursor: onToggle ? "pointer" : "default",
          flexShrink: 0,
          marginTop: "2px",
        }}
        onClick={onToggle}
        role={onToggle ? "checkbox" : undefined}
        aria-checked={onToggle ? completed : undefined}
        aria-label={onToggle ? `Mark "${title}" as ${completed ? "incomplete" : "complete"}` : undefined}
        tabIndex={onToggle ? 0 : undefined}
        onKeyDown={
          onToggle ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle()) : undefined
        }
      >
        {completed ? (
          <Icon source={CheckCircleIcon} tone="success" />
        ) : (
          <div
            style={{
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              border: "2px solid var(--p-color-icon-secondary)",
              boxSizing: "border-box",
            }}
          />
        )}
      </div>
      <BlockStack gap="100">
        <Text
          as="span"
          variant="bodyMd"
          fontWeight={completed ? "regular" : "semibold"}
        >
          {title}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {description}
        </Text>
        {buttonText && buttonUrl && !completed && (
          <div>
            <Button url={buttonUrl} target={target || undefined} size="slim">
              {buttonText}
            </Button>
          </div>
        )}
      </BlockStack>
    </InlineStack>
  );
}

export default function Index() {
  const data = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const revalidator = useRevalidator();

  const {
    tierInfo,
    totalDiscountCount,
    liveDiscountCount,
    manualTaskStatuses: initialManualStatuses,
    embedBlockStatus,
    showDevTools,
    installStatus,
    appVersion,
  } = data;

  const manualTaskStatuses =
    actionData?.manualTaskStatuses || initialManualStatuses;

  // Auto-refresh when zero discounts (data may still be importing)
  useEffect(() => {
    if (installStatus === "failed" || installStatus === "done") return;
    if (totalDiscountCount > 0 || liveDiscountCount > 0) return;

    const timers = [250, 1000].map((delay) =>
      setTimeout(() => revalidator.revalidate(), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [totalDiscountCount, liveDiscountCount, installStatus, revalidator]);

  const handleToggleTask = useCallback(
    (taskTitle, currentCompleted) => {
      const formData = new FormData();
      formData.set("taskTitle", taskTitle);
      formData.set("completed", currentCompleted ? "false" : "true");
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const handleRefreshDevTunnel = useCallback(() => {
    submit(null, { method: "post", action: "/app/refresh-metafields" });
  }, [submit]);

  const handleRetryImport = useCallback(() => {
    submit(null, { method: "post", action: "/app/rebuild" });
  }, [submit]);

  // Build setup tasks list
  const embedAutoDetected =
    embedBlockStatus.checked && embedBlockStatus.enabled;
  const tasks = [
    {
      title: "Create your first discount",
      description: "Create a discount in your Shopify admin to get started.",
      completed: totalDiscountCount > 0,
      auto: true,
    },
    {
      title: "Make discount live",
      description: "Set at least one discount to live status.",
      completed: liveDiscountCount > 0,
      auto: true,
    },
    {
      title: "Enable embed block",
      description: MANUAL_TASK_DEFINITIONS["Enable embed block"].description,
      completed:
        embedAutoDetected || manualTaskStatuses["Enable embed block"],
      buttonText: MANUAL_TASK_DEFINITIONS["Enable embed block"].buttonText,
      buttonUrl: MANUAL_TASK_DEFINITIONS["Enable embed block"].buttonUrl,
      target: MANUAL_TASK_DEFINITIONS["Enable embed block"].target,
      isManual: !embedAutoDetected,
    },
    {
      title: "Customize appearance (optional)",
      description:
        MANUAL_TASK_DEFINITIONS["Customize appearance (optional)"].description,
      completed: manualTaskStatuses["Customize appearance (optional)"],
      buttonText:
        MANUAL_TASK_DEFINITIONS["Customize appearance (optional)"].buttonText,
      buttonUrl:
        MANUAL_TASK_DEFINITIONS["Customize appearance (optional)"].buttonUrl,
      isManual: true,
    },
  ];

  const completedCount = tasks.filter((t) => t.completed).length;
  const progressPercent = Math.round(
    (completedCount / tasks.length) * 100,
  );

  // Pending downgrade info
  const hasPendingDowngrade =
    tierInfo.pendingTier && tierInfo.pendingTier !== tierInfo.tier;
  const pendingTierName = hasPendingDowngrade
    ? tierInfo.pendingTier.charAt(0) +
      tierInfo.pendingTier.slice(1).toLowerCase()
    : null;

  return (
    <Page title="Discount Display Pro">
      <BlockStack gap="500">
        {/* Install Failed Banner */}
        {installStatus === "failed" && (
          <Banner
            title="Initial import failed"
            tone="critical"
            action={{
              content: "Retry import",
              onAction: handleRetryImport,
            }}
          >
            <p>
              The initial discount import encountered an error. Please retry to
              sync your discounts.
            </p>
          </Banner>
        )}

        {/* Embed Block Warning */}
        {liveDiscountCount > 0 &&
          embedBlockStatus.checked &&
          !embedBlockStatus.enabled && (
            <Banner title="App embed is disabled" tone="warning">
              <p>
                You have {liveDiscountCount} live discount
                {liveDiscountCount !== 1 ? "s" : ""}, but the app embed is
                disabled in your theme. Customers won&apos;t see discount badges
                on your storefront until you enable it.
              </p>
            </Banner>
          )}

        <Layout>
          {/* Setup Checklist */}
          {installStatus === "done" && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Setup Progress
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {completedCount} of {tasks.length} completed
                    </Text>
                  </InlineStack>
                  <ProgressBar
                    progress={progressPercent}
                    size="small"
                    tone="primary"
                  />
                  <BlockStack gap="400">
                    {tasks.map((task) => (
                      <TaskItem
                        key={task.title}
                        title={task.title}
                        description={task.description}
                        completed={task.completed}
                        buttonText={task.buttonText}
                        buttonUrl={task.buttonUrl}
                        target={task.target}
                        onToggle={
                          task.isManual
                            ? () =>
                                handleToggleTask(task.title, task.completed)
                            : undefined
                        }
                      />
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* Tier Usage Card */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Plan: {tierInfo.tierName}
                  </Text>
                  <Badge tone={hasPendingDowngrade ? "critical" : "success"}>
                    {hasPendingDowngrade ? "Cancelled" : "Active"}
                  </Badge>
                </InlineStack>

                {tierInfo.isUnlimited ? (
                  <Text as="p" variant="bodyMd">
                    {tierInfo.currentLiveDiscounts} live discount
                    {tierInfo.currentLiveDiscounts !== 1 ? "s" : ""} (unlimited)
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">
                        {tierInfo.currentLiveDiscounts} of{" "}
                        {tierInfo.liveDiscountLimit} live discounts
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {tierInfo.usagePercentage}%
                      </Text>
                    </InlineStack>
                    <ProgressBar
                      progress={tierInfo.usagePercentage}
                      size="small"
                      tone={
                        tierInfo.usagePercentage >= 100 ? "critical" : "primary"
                      }
                    />
                  </BlockStack>
                )}

                {hasPendingDowngrade && (
                  <Banner tone="info">
                    Downgrade to {pendingTierName} will take effect after this
                    billing cycle
                    {tierInfo.pendingTierEffectiveAt
                      ? ` (${new Date(tierInfo.pendingTierEffectiveAt).toLocaleDateString()})`
                      : ""}
                    .
                  </Banner>
                )}

                <Button url="/app/pricing">View Plans & Upgrade</Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Help & Resources Card */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Help & Resources
                </Text>
                <InlineStack gap="300">
                  <Button
                    url={HELP_URL}
                    target="_blank"
                    variant="plain"
                  >
                    Knowledge Base
                  </Button>
                  <Button
                    url={SUPPORT_EMAIL}
                    variant="plain"
                  >
                    Contact Support
                  </Button>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Version {appVersion}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Developer Tools Card */}
          {showDevTools && (
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Developer Tools
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Update webhook URLs and storefront API metafields for the
                    current dev tunnel.
                  </Text>
                  <div>
                    <Button onClick={handleRefreshDevTunnel}>
                      Refresh Dev Tunnel
                    </Button>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
