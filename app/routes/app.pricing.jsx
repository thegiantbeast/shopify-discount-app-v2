import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  InlineGrid,
  Box,
  Divider,
  Modal,
  List,
} from "@shopify/polaris";
import { getAvailableTiers, TIER_CONFIG, TIER_KEYS } from "../utils/tier-manager.js";
import { SALES_EMAIL } from "../utils/constants.js";

export const loader = async ({ request }) => {
  const { authenticate, buildPlanSelectionUrl } = await import(
    "../shopify.server"
  );
  const { createLogger } = await import("../utils/logger.server.js");
  const prisma = (await import("../db.server.js")).default;
  const { getShopTierInfo } = await import(
    "../utils/tier-manager.server.js"
  );

  const logger = createLogger("PricingPage");
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  const tierInfo = await getShopTierInfo(shopDomain, prisma);
  const planSelectionUrl = buildPlanSelectionUrl(shopDomain);

  // Fetch active subscription details from Shopify
  let activeSubscription = null;
  try {
    const response = await admin.graphql(`
      query ManagedPricingSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            trialDays
            currentPeriodEnd
            createdAt
            test
            lineItems {
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    planHandle
                    interval
                    price { amount currencyCode }
                    discount {
                      durationLimitInIntervals
                      remainingDurationInIntervals
                      value {
                        ... on AppSubscriptionDiscountPercentage { percentage }
                        ... on AppSubscriptionDiscountAmount { amount { amount currencyCode } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);
    const data = await response.json();
    const subscriptions =
      data.data?.currentAppInstallation?.activeSubscriptions || [];
    activeSubscription = subscriptions[0] || null;

    // Sync billing metadata if we have subscription data
    if (activeSubscription?.currentPeriodEnd) {
      try {
        const shop = await prisma.shop.findUnique({
          where: { domain: shopDomain },
        });
        if (shop) {
          const updates = {
            billingCurrentPeriodEnd: new Date(
              activeSubscription.currentPeriodEnd,
            ),
          };
          if (shop.pendingTier && !shop.pendingTierEffectiveAt) {
            updates.pendingTierEffectiveAt = new Date(
              activeSubscription.currentPeriodEnd,
            );
          }
          await prisma.shop.update({
            where: { domain: shopDomain },
            data: updates,
          });
        }
      } catch (syncErr) {
        logger.warn(
          "Failed to sync billing metadata",
          { err: syncErr, shop: shopDomain },
        );
      }
    }
  } catch (error) {
    logger.warn(
      "Failed to fetch subscription data",
      { err: error, shop: shopDomain },
    );
  }

  // Parse subscription details for display
  let subscriptionDisplay = null;
  if (activeSubscription) {
    const lineItem = activeSubscription.lineItems?.[0];
    const pricing = lineItem?.plan?.pricingDetails;
    const discount = pricing?.discount;

    let trialDaysRemaining = 0;
    if (activeSubscription.trialDays > 0 && activeSubscription.createdAt) {
      const created = new Date(activeSubscription.createdAt);
      const trialEnd = new Date(created);
      trialEnd.setDate(trialEnd.getDate() + activeSubscription.trialDays);
      const now = new Date();
      if (trialEnd > now) {
        trialDaysRemaining = Math.ceil(
          (trialEnd - now) / (1000 * 60 * 60 * 24),
        );
      }
    }

    subscriptionDisplay = {
      name: activeSubscription.name,
      status: activeSubscription.status,
      interval: pricing?.interval || null,
      price: pricing?.price
        ? `$${parseFloat(pricing.price.amount).toFixed(2)}`
        : null,
      currentPeriodEnd: activeSubscription.currentPeriodEnd,
      trialDays: activeSubscription.trialDays,
      trialDaysRemaining,
      test: activeSubscription.test,
      discount: discount
        ? {
            percentage: discount.value?.percentage,
            amount: discount.value?.amount
              ? `$${parseFloat(discount.value.amount.amount).toFixed(2)}`
              : null,
            durationLimit: discount.durationLimitInIntervals,
            remaining: discount.remainingDurationInIntervals,
          }
        : null,
    };
  }

  // Check for billing flow return parameters
  const url = new URL(request.url);
  const billingSuccess = url.searchParams.has("billing")
    ? url.searchParams.get("billing") === "success"
    : null;

  return json({
    tierInfo,
    availableTiers: getAvailableTiers(),
    planSelectionUrl,
    subscription: subscriptionDisplay,
    billingSuccess,
  });
};

const INTERVAL_LABELS = {
  EVERY_30_DAYS: "Every 30 days",
  ANNUAL: "Annually",
  EVERY_90_DAYS: "Every 90 days",
};

export default function PricingPage() {
  const {
    tierInfo,
    availableTiers,
    planSelectionUrl,
    subscription,
    billingSuccess,
  } = useLoaderData();

  const [downgradeModalOpen, setDowngradeModalOpen] = useState(false);
  const [downgradeTarget, setDowngradeTarget] = useState(null);

  const currentTierIndex = TIER_KEYS.indexOf(tierInfo.tier);

  const handlePlanClick = useCallback(
    (tierKey) => {
      const targetIndex = TIER_KEYS.indexOf(tierKey);

      // Downgrade: show modal first
      if (targetIndex < currentTierIndex && currentTierIndex > 0) {
        setDowngradeTarget(tierKey);
        setDowngradeModalOpen(true);
        return;
      }

      // Upgrade or same tier: go to managed pricing
      if (planSelectionUrl) {
        window.top.location.href = planSelectionUrl;
      }
    },
    [currentTierIndex, planSelectionUrl],
  );

  const handleDowngradeAcknowledge = useCallback(() => {
    setDowngradeModalOpen(false);
    setDowngradeTarget(null);
    if (planSelectionUrl) {
      window.top.location.href = planSelectionUrl;
    }
  }, [planSelectionUrl]);

  const hasPendingDowngrade =
    tierInfo.pendingTier && tierInfo.pendingTier !== tierInfo.tier;
  const pendingTierName = hasPendingDowngrade
    ? TIER_CONFIG[tierInfo.pendingTier]?.name || tierInfo.pendingTier
    : null;

  const downgradeTargetConfig = downgradeTarget
    ? TIER_CONFIG[downgradeTarget]
    : null;

  return (
    <Page title="Subscription">
      <BlockStack gap="500">
        {billingSuccess === true && (
          <Banner title="Plan updated successfully" tone="success" />
        )}
        {billingSuccess === false && (
          <Banner title="There was an issue updating your plan" tone="critical">
            <p>Please try again or contact support if the issue persists.</p>
          </Banner>
        )}

        {hasPendingDowngrade && (
          <Banner title="Pending plan change" tone="info">
            <p>
              Your plan will change from {tierInfo.tierName} to{" "}
              {pendingTierName} at the end of your current billing period
              {tierInfo.pendingTierEffectiveAt
                ? ` (${new Date(tierInfo.pendingTierEffectiveAt).toLocaleDateString()})`
                : ""}
              .
            </p>
          </Banner>
        )}

        <Layout>
          {/* Current Plan Section */}
          {subscription && (
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Current Plan: {subscription.name}
                    </Text>
                    <Badge
                      tone={
                        subscription.status === "ACTIVE"
                          ? "success"
                          : "critical"
                      }
                    >
                      {subscription.status === "ACTIVE"
                        ? "Active"
                        : subscription.status}
                    </Badge>
                  </InlineStack>

                  {subscription.price && (
                    <Text as="p" variant="bodyMd">
                      {subscription.price}/month
                      {subscription.interval
                        ? ` \u2014 ${INTERVAL_LABELS[subscription.interval] || subscription.interval}`
                        : ""}
                    </Text>
                  )}

                  {subscription.currentPeriodEnd && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Current period ends:{" "}
                      {new Date(
                        subscription.currentPeriodEnd,
                      ).toLocaleDateString()}
                    </Text>
                  )}

                  {subscription.trialDaysRemaining > 0 && (
                    <Banner tone="info">
                      {subscription.trialDaysRemaining} day
                      {subscription.trialDaysRemaining !== 1 ? "s" : ""}{" "}
                      remaining in your trial.
                    </Banner>
                  )}

                  {subscription.discount && (
                    <Text as="p" variant="bodySm" tone="success">
                      Discount applied:{" "}
                      {subscription.discount.percentage
                        ? `${subscription.discount.percentage}% off`
                        : subscription.discount.amount
                          ? `${subscription.discount.amount} off`
                          : "Active"}
                      {subscription.discount.remaining != null
                        ? ` (${subscription.discount.remaining} interval${subscription.discount.remaining !== 1 ? "s" : ""} remaining)`
                        : ""}
                    </Text>
                  )}

                  {subscription.test && (
                    <Badge tone="attention">Test subscription</Badge>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* Plan Cards Grid */}
          <Layout.Section>
            <InlineGrid columns={{ xs: 1, sm: 1, md: 3 }} gap="400">
              {availableTiers.map((tier) => {
                const isCurrent = tier.key === tierInfo.tier;
                const isAdvanced = tier.key === "ADVANCED";

                return (
                  <Card
                    key={tier.key}
                    background={
                      isAdvanced ? "bg-surface-inverse" : "bg-surface"
                    }
                  >
                    <BlockStack gap="400">
                      <InlineStack align="space-between">
                        <Text
                          as="h2"
                          variant="headingMd"
                          tone={isAdvanced ? "text-inverse" : undefined}
                        >
                          {tier.name}
                        </Text>
                        {isAdvanced && (
                          <Badge tone="info">Most Popular</Badge>
                        )}
                        {isCurrent && <Badge tone="success">Current</Badge>}
                      </InlineStack>

                      <BlockStack gap="100">
                        <Text
                          as="p"
                          variant="headingXl"
                          tone={isAdvanced ? "text-inverse" : undefined}
                        >
                          {tier.price === 0
                            ? "Free"
                            : `$${tier.price.toFixed(2)}`}
                          <Text
                            as="span"
                            variant="bodySm"
                            tone={isAdvanced ? "text-inverse" : "subdued"}
                          >
                            /month
                          </Text>
                        </Text>
                        <Text
                          as="p"
                          variant="bodySm"
                          tone={isAdvanced ? "text-inverse" : "subdued"}
                        >
                          Billed through Shopify
                        </Text>
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="200">
                        <Text
                          as="p"
                          variant="bodySm"
                          fontWeight="semibold"
                          tone={isAdvanced ? "text-inverse" : undefined}
                        >
                          {tier.isUnlimited
                            ? "Unlimited live discounts"
                            : `${tier.liveDiscountLimit} live discount${tier.liveDiscountLimit !== 1 ? "s" : ""}`}
                        </Text>
                        <List>
                          {tier.features.map((feature, i) => (
                            <List.Item key={i}>
                              <Text
                                as="span"
                                fontWeight={feature.bold ? "bold" : "regular"}
                              >
                                {feature.text}
                              </Text>
                            </List.Item>
                          ))}
                        </List>
                      </BlockStack>

                      <Button
                        variant={isCurrent ? "secondary" : "primary"}
                        onClick={() => handlePlanClick(tier.key)}
                        disabled={isCurrent && !hasPendingDowngrade}
                        fullWidth
                      >
                        {isCurrent
                          ? hasPendingDowngrade
                            ? "Manage plan"
                            : "Current plan"
                          : "Choose plan"}
                      </Button>
                    </BlockStack>
                  </Card>
                );
              })}
            </InlineGrid>
          </Layout.Section>

          {/* Contact Sales */}
          <Layout.Section>
            <Box paddingBlockStart="400" paddingBlockEnd="800">
              <InlineStack align="center">
                <Button
                  url={SALES_EMAIL}
                  variant="plain"
                >
                  Contact Sales
                </Button>
              </InlineStack>
            </Box>
          </Layout.Section>
        </Layout>

        {/* Downgrade Modal */}
        <Modal
          open={downgradeModalOpen}
          onClose={() => setDowngradeModalOpen(false)}
          title="Downgrade plan"
          primaryAction={{
            content: "Acknowledge",
            onAction: handleDowngradeAcknowledge,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setDowngradeModalOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd">
                Downgrades take effect at the end of your current billing
                cycle. You&apos;ll keep your current plan features until then.
              </Text>
              {downgradeTargetConfig && (
                <Text as="p" variant="bodyMd">
                  The {downgradeTargetConfig.name} plan allows{" "}
                  {downgradeTargetConfig.liveDiscountLimit === null
                    ? "unlimited"
                    : downgradeTargetConfig.liveDiscountLimit}{" "}
                  live discount
                  {downgradeTargetConfig.liveDiscountLimit !== 1 ? "s" : ""}.
                  {tierInfo.currentLiveDiscounts >
                    (downgradeTargetConfig.liveDiscountLimit || 0) &&
                    downgradeTargetConfig.liveDiscountLimit !== null && (
                      <Text as="span" variant="bodyMd" tone="critical">
                        {" "}
                        You currently have {tierInfo.currentLiveDiscounts} live
                        discounts. All discounts will be set to hidden when the
                        downgrade takes effect.
                      </Text>
                    )}
                </Text>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
