import { json } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import { useState, useCallback, useMemo } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  IndexTable,
  Badge,
  Button,
  Banner,
  ProgressBar,
  InlineStack,
  BlockStack,
  EmptyState,
  Tabs,
  Box,
  useIndexResourceState,
} from "@shopify/polaris";

const STATUS_PRIORITY = [
  "LIVE",
  "HIDDEN",
  "SCHEDULED",
  "NOT_SUPPORTED",
  "UPGRADE_REQUIRED",
];

const STATUS_BADGE_MAP = {
  LIVE: { tone: "success", label: "Live" },
  HIDDEN: { tone: "attention", label: "Hidden" },
  SCHEDULED: { tone: "info", label: "Scheduled" },
  NOT_SUPPORTED: { tone: "new", label: "Not Supported" },
  UPGRADE_REQUIRED: { tone: "warning", label: "Upgrade Required" },
};

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const prisma = (await import("../db.server.js")).default;
  const { getShopTierInfo } = await import(
    "../utils/tier-manager.server.js"
  );
  const { ensureLiveDiscountsForShop } = await import(
    "../utils/discount-resolver/backfill.server.js"
  );

  const { session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  const tierInfo = await getShopTierInfo(shopDomain, prisma);

  // Backfill check: if Discount count exceeds LiveDiscount count, recover
  const [discountCount, liveDiscountCount] = await Promise.all([
    prisma.discount.count({ where: { shop: shopDomain } }),
    prisma.liveDiscount.count({ where: { shop: shopDomain } }),
  ]);

  if (discountCount > liveDiscountCount) {
    await ensureLiveDiscountsForShop(shopDomain, prisma);
  }

  // Fetch non-expired LiveDiscounts
  const now = new Date();
  const liveDiscounts = await prisma.liveDiscount.findMany({
    where: {
      shop: shopDomain,
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });

  // Enrich with titles from Discount table
  const discountGids = liveDiscounts.map((d) => d.gid);
  const discounts =
    discountGids.length > 0
      ? await prisma.discount.findMany({
          where: { gid: { in: discountGids }, shop: shopDomain },
          select: { gid: true, title: true },
        })
      : [];
  const titleMap = Object.fromEntries(
    discounts.map((d) => [d.gid, d.title]),
  );

  // Sort by status priority, then by createdAt desc
  const enriched = liveDiscounts
    .map((d) => ({
      id: d.id,
      gid: d.gid,
      title: titleMap[d.gid] || d.summary || "Untitled Discount",
      summary: d.summary,
      discountType: d.discountType,
      status: d.status,
      exclusionReason: d.exclusionReason,
      exclusionDetails: d.exclusionDetails,
      startsAt: d.startsAt?.toISOString(),
      endsAt: d.endsAt?.toISOString(),
      createdAt: d.createdAt?.toISOString(),
    }))
    .sort((a, b) => {
      const aPriority = STATUS_PRIORITY.indexOf(a.status);
      const bPriority = STATUS_PRIORITY.indexOf(b.status);
      if (aPriority !== bPriority) return aPriority - bPriority;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

  return json({ discounts: enriched, tierInfo, shop: shopDomain });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { createLogger } = await import("../utils/logger.server.js");
  const prisma = (await import("../db.server.js")).default;
  const { getShopTierInfo } = await import(
    "../utils/tier-manager.server.js"
  );
  const { ensureLiveDiscountsForShop } = await import(
    "../utils/discount-resolver/backfill.server.js"
  );
  const { reprocessAllDiscountsForShop } = await import(
    "../utils/discount-resolver/reprocess.server.js"
  );

  const logger = createLogger("DiscountsPage");
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");
  const selectedIds = formData.getAll("selectedIds");

  try {
    if (intent === "activate") {
      // Validate tier limits before activation
      const tierInfo = await getShopTierInfo(shopDomain, prisma);
      if (!tierInfo.isUnlimited) {
        const remaining =
          tierInfo.liveDiscountLimit - tierInfo.currentLiveDiscounts;
        if (selectedIds.length > remaining) {
          return json(
            {
              error:
                "Activating these discounts would exceed your plan limit.",
              tierLimit: true,
            },
            { status: 400 },
          );
        }
      }

      let scheduledActivated = false;
      const now = new Date();

      for (const id of selectedIds) {
        const ld = await prisma.liveDiscount.findUnique({ where: { id } });
        if (ld && (ld.status === "HIDDEN" || ld.status === "SCHEDULED")) {
          await prisma.liveDiscount.update({
            where: { id },
            data: { status: "LIVE" },
          });
          await prisma.discount.updateMany({
            where: { gid: ld.gid, shop: shopDomain },
            data: { status: "ACTIVE" },
          });
          if (ld.startsAt && new Date(ld.startsAt) > now) {
            scheduledActivated = true;
          }
        }
      }

      return json({
        success: true,
        activated: selectedIds.length,
        scheduledActivated,
      });
    }

    if (intent === "deactivate") {
      for (const id of selectedIds) {
        const ld = await prisma.liveDiscount.findUnique({ where: { id } });
        if (ld && ld.status === "LIVE") {
          await prisma.liveDiscount.update({
            where: { id },
            data: { status: "HIDDEN" },
          });
        }
      }
      return json({ success: true, deactivated: selectedIds.length });
    }

    if (intent === "resync") {
      const result = await reprocessAllDiscountsForShop(
        admin,
        shopDomain,
        prisma,
      );
      const backfillResult = await ensureLiveDiscountsForShop(
        shopDomain,
        prisma,
      );
      return json({
        success: true,
        resynced: true,
        processed: result.processed || 0,
        backfilled: backfillResult.backfilled,
      });
    }

    return json({ error: "Unknown intent" }, { status: 400 });
  } catch (error) {
    logger.error(
      "Discount action failed",
      { err: error, shop: shopDomain, intent },
    );
    return json({ error: "Action failed" }, { status: 500 });
  }
};

const TAB_FILTERS = [
  { id: "all", content: "All", filter: () => true },
  { id: "visible", content: "Visible", filter: (d) => d.status === "LIVE" },
  {
    id: "hidden",
    content: "Hidden",
    filter: (d) => d.status === "HIDDEN" || d.status === "SCHEDULED",
  },
  {
    id: "unsupported",
    content: "Unsupported",
    filter: (d) =>
      d.status === "NOT_SUPPORTED" || d.status === "UPGRADE_REQUIRED",
  },
];

function isSelectableDiscount(discount) {
  return (
    discount.status !== "NOT_SUPPORTED" &&
    discount.status !== "UPGRADE_REQUIRED"
  );
}

export default function DiscountsPage() {
  const { discounts, tierInfo } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedTab, setSelectedTab] = useState(0);

  const isLoading = navigation.state !== "idle";

  const filteredDiscounts = useMemo(
    () => discounts.filter(TAB_FILTERS[selectedTab].filter),
    [discounts, selectedTab],
  );

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(filteredDiscounts);

  const handleTabChange = useCallback(
    (index) => {
      setSelectedTab(index);
      handleSelectionChange("page", false);
    },
    [handleSelectionChange],
  );

  const handleActivate = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "activate");
    for (const id of selectedResources) {
      formData.append("selectedIds", id);
    }
    submit(formData, { method: "post" });
    handleSelectionChange("page", false);
  }, [selectedResources, submit, handleSelectionChange]);

  const handleDeactivate = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "deactivate");
    for (const id of selectedResources) {
      formData.append("selectedIds", id);
    }
    submit(formData, { method: "post" });
    handleSelectionChange("page", false);
  }, [selectedResources, submit, handleSelectionChange]);

  const handleResync = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "resync");
    submit(formData, { method: "post" });
  }, [submit]);

  // Determine bulk actions based on selected discounts
  const selectedStatuses = selectedResources
    .map((id) => discounts.find((d) => d.id === id)?.status)
    .filter(Boolean);

  const hasHiddenSelected = selectedStatuses.some(
    (s) => s === "HIDDEN" || s === "SCHEDULED",
  );
  const hasLiveSelected = selectedStatuses.some((s) => s === "LIVE");

  const promotedBulkActions = [];
  if (hasHiddenSelected) {
    promotedBulkActions.push({
      content: "Set as live",
      onAction: handleActivate,
    });
  }
  if (hasLiveSelected) {
    promotedBulkActions.push({
      content: "Set as hidden",
      onAction: handleDeactivate,
    });
  }

  const atLimit =
    !tierInfo.isUnlimited &&
    tierInfo.currentLiveDiscounts >= tierInfo.liveDiscountLimit;

  const rowMarkup = filteredDiscounts.map((discount, index) => {
    const badgeInfo = STATUS_BADGE_MAP[discount.status] || {
      tone: "new",
      label: discount.status,
    };
    const isScheduled =
      discount.startsAt && new Date(discount.startsAt) > new Date();

    return (
      <IndexTable.Row
        id={discount.id}
        key={discount.id}
        position={index}
        selected={selectedResources.includes(discount.id)}
        disabled={!isSelectableDiscount(discount)}
      >
        <IndexTable.Cell>
          <BlockStack gap="100">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {discount.title}
            </Text>
            {discount.summary && (
              <Text as="span" variant="bodySm" tone="subdued">
                {discount.summary}
              </Text>
            )}
            {discount.exclusionDetails && (
              <Text as="span" variant="bodySm" tone="subdued">
                {discount.exclusionDetails}
              </Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {isScheduled && <Badge tone="info">Scheduled</Badge>}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={badgeInfo.tone}>{badgeInfo.label}</Badge>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Manage Discounts"
      primaryAction={{
        content: "Resync All",
        onAction: handleResync,
        loading: isLoading,
      }}
    >
      <BlockStack gap="500">
        {actionData?.error && (
          <Banner
            title={actionData.tierLimit ? "Plan limit reached" : "Error"}
            tone={actionData.tierLimit ? "warning" : "critical"}
          >
            <p>{actionData.error}</p>
            {actionData.tierLimit && (
              <Button url="/app/pricing" variant="plain">
                View upgrade options
              </Button>
            )}
          </Banner>
        )}

        {actionData?.resynced && (
          <Banner title="Resync complete" tone="success">
            <p>
              Processed {actionData.processed || 0} discounts.
              {actionData.backfilled > 0
                ? ` Backfilled ${actionData.backfilled} records.`
                : ""}
            </p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="0">
                {/* Plan usage header */}
                <Box padding="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm">
                      {tierInfo.isUnlimited
                        ? `${tierInfo.currentLiveDiscounts} live discounts (unlimited)`
                        : `${tierInfo.currentLiveDiscounts} of ${tierInfo.liveDiscountLimit} live discounts used`}
                    </Text>
                    {!tierInfo.isUnlimited && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {tierInfo.tierName} plan
                      </Text>
                    )}
                  </InlineStack>
                  {!tierInfo.isUnlimited && (
                    <div style={{ marginTop: "8px" }}>
                      <ProgressBar
                        progress={tierInfo.usagePercentage}
                        size="small"
                        tone={atLimit ? "critical" : "primary"}
                      />
                    </div>
                  )}
                </Box>

                {atLimit && (
                  <Box padding="400" paddingBlockStart="0">
                    <Banner tone="warning">
                      You&apos;ve reached your plan limit of{" "}
                      {tierInfo.liveDiscountLimit} live discount
                      {tierInfo.liveDiscountLimit !== 1 ? "s" : ""}.{" "}
                      <Button url="/app/pricing" variant="plain">
                        Upgrade
                      </Button>{" "}
                      for more.
                    </Banner>
                  </Box>
                )}

                <Tabs
                  tabs={TAB_FILTERS.map((t) => ({
                    id: t.id,
                    content: t.content,
                  }))}
                  selected={selectedTab}
                  onSelect={handleTabChange}
                />

                {filteredDiscounts.length === 0 ? (
                  <Box padding="1600">
                    <EmptyState
                      heading="No discounts found"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>
                        {selectedTab === 0
                          ? "Create a discount in your Shopify admin to get started."
                          : "No discounts match this filter."}
                      </p>
                    </EmptyState>
                  </Box>
                ) : (
                  <IndexTable
                    resourceName={{
                      singular: "discount",
                      plural: "discounts",
                    }}
                    itemCount={filteredDiscounts.length}
                    selectedItemsCount={
                      allResourcesSelected ? "All" : selectedResources.length
                    }
                    onSelectionChange={handleSelectionChange}
                    headings={[
                      { title: "Description" },
                      { title: "" },
                      { title: "Status" },
                    ]}
                    promotedBulkActions={promotedBulkActions}
                    loading={isLoading}
                  >
                    {rowMarkup}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
