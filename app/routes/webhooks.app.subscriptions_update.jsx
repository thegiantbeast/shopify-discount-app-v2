import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  const { createLogger } = await import("../utils/logger.server.js");
  const logger = createLogger("WebhookSubscriptionsUpdate");

  const { resolveTierFromPlanName } = await import("../shopify.server");
  const {
    updateShopTier,
    scheduleShopTierChange,
    getOrCreateShopTier,
    getEffectiveTierFromShopRecord,
    getTierPrice,
  } = await import("../utils/tier-manager.server.js");

  const webhookId = request.headers.get("x-shopify-webhook-id");
  logger.info("Received app_subscriptions/update webhook", { shop, topic, webhookId });

  try {
    const subscriptionGid = payload?.app_subscription?.admin_graphql_api_id;
    const status = payload?.app_subscription?.status;
    const planName = payload?.app_subscription?.name;

    // Enrich subscription data from GraphQL if admin is available
    let enrichedSubscription = null;
    let planHandle = null;
    let planTrialDays = 0;
    let subscriptionCurrentPeriodEnd = null;
    let createdAtDate = null;
    let priceAmount = null;
    let priceCurrency = null;
    let discountPercentage = null;
    let discountAmount = null;
    let discountCurrency = null;
    let discountDurationLimit = null;
    let discountRemainingDuration = null;
    let planInterval = null;

    if (admin && subscriptionGid) {
      try {
        const { graphqlQuery } = await import("../utils/discount-resolver/graphql-client.server.js");
        const enrichResult = await graphqlQuery(admin, `
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

        const subscriptions = enrichResult.data?.currentAppInstallation?.activeSubscriptions || [];
        enrichedSubscription = subscriptions.find((s) => s.id === subscriptionGid) || subscriptions[0];

        if (enrichedSubscription) {
          const lineItem = enrichedSubscription.lineItems?.[0];
          const pricing = lineItem?.plan?.pricingDetails;
          planHandle = pricing?.planHandle || null;
          planInterval = pricing?.interval || null;
          priceAmount = pricing?.price ? parseFloat(pricing.price.amount) : null;
          priceCurrency = pricing?.price?.currencyCode || null;
          planTrialDays = enrichedSubscription.trialDays || 0;
          subscriptionCurrentPeriodEnd = enrichedSubscription.currentPeriodEnd || null;
          createdAtDate = enrichedSubscription.createdAt ? new Date(enrichedSubscription.createdAt) : null;

          const disc = pricing?.discount;
          if (disc) {
            discountDurationLimit = disc.durationLimitInIntervals;
            discountRemainingDuration = disc.remainingDurationInIntervals;
            if (disc.value?.percentage !== undefined) {
              discountPercentage = disc.value.percentage;
            }
            if (disc.value?.amount) {
              discountAmount = parseFloat(disc.value.amount.amount);
              discountCurrency = disc.value.amount.currencyCode;
            }
          }
        }
      } catch (enrichErr) {
        logger.warn("Failed to enrich subscription data", { err: enrichErr, shop });
      }
    }

    // Compute trial end
    let computedTrialEndDate = null;
    if (planTrialDays > 0 && createdAtDate) {
      computedTrialEndDate = new Date(createdAtDate);
      computedTrialEndDate.setDate(computedTrialEndDate.getDate() + planTrialDays);
      if (subscriptionCurrentPeriodEnd) {
        const periodEnd = new Date(subscriptionCurrentPeriodEnd);
        if (periodEnd < computedTrialEndDate) {
          computedTrialEndDate = periodEnd;
        }
      }
    }
    const isTrialActive = computedTrialEndDate && new Date() < computedTrialEndDate;

    // Log to PlanSubscriptionLog
    try {
      await prisma.planSubscriptionLog.create({
        data: {
          shopDomain: shop,
          topic,
          webhookId: webhookId || null,
          status: status || null,
          subscriptionId: subscriptionGid || null,
          planHandle,
          planName: planName || enrichedSubscription?.name || null,
          interval: planInterval,
          priceAmount,
          priceCurrency,
          discountPercentage,
          discountAmount,
          discountCurrency,
          discountDurationLimit,
          discountRemainingDuration,
          currentPeriodEnd: subscriptionCurrentPeriodEnd ? new Date(subscriptionCurrentPeriodEnd) : null,
          trialDays: planTrialDays || null,
          trialEnd: computedTrialEndDate,
          trialActive: isTrialActive || false,
        },
      });
    } catch (logErr) {
      logger.error("Failed to log subscription webhook", { err: logErr, shop });
    }

    // Handle status
    if (status === "DECLINED" || status === "EXPIRED") {
      logger.info("Ignoring DECLINED/EXPIRED subscription status", { shop, status });
      return new Response(null, { status: 200 });
    }

    if (status === "CANCELLED") {
      logger.info("Ignoring CANCELLED — will process the accompanying ACTIVE webhook instead", { shop, status });
      return new Response(null, { status: 200 });
    }

    const shopRecord = await getOrCreateShopTier(shop, prisma);
    const currentTier = getEffectiveTierFromShopRecord(shopRecord);

    if (status === "FROZEN") {
      if (currentTier !== "FREE") {
        await updateShopTier(shop, "FREE", prisma, { updateBillingTier: true });
        logger.info("Frozen — downgraded to FREE", { shop, previousTier: currentTier });

        if (admin) {
          const { reprocessAllDiscountsForShop } = await import("../utils/discount-resolver/reprocess.server.js");
          await reprocessAllDiscountsForShop(admin, shop, prisma);
        }
      }
      return new Response(null, { status: 200 });
    }

    if (status !== "ACTIVE" && status !== "ACCEPTED") {
      logger.info("Ignoring non-active subscription status", { shop, status });
      return new Response(null, { status: 200 });
    }

    // ACTIVE / ACCEPTED processing
    const resolvedTier = resolveTierFromPlanName(planName, planHandle);
    const nextTier = resolvedTier || "FREE";

    const currentPrice = getTierPrice(currentTier) || 0;
    const newPrice = getTierPrice(nextTier) || 0;

    logger.info("Processing tier change", {
      shop, currentTier, nextTier, currentPrice, newPrice, planHandle, planName,
    });

    const tierChanged = nextTier !== currentTier;
    const isUpgrade = newPrice >= currentPrice;
    const allowDeferredDowngrade = !isTrialActive;

    if (isUpgrade || !allowDeferredDowngrade) {
      // Apply immediately
      if (tierChanged) {
        await updateShopTier(shop, nextTier, prisma, { updateBillingTier: true });
        logger.info("Tier upgraded immediately", { shop, from: currentTier, to: nextTier });
      }
    } else {
      // Deferred downgrade
      const effectiveAt = subscriptionCurrentPeriodEnd || shopRecord.billingCurrentPeriodEnd;
      await scheduleShopTierChange(shop, nextTier, effectiveAt, prisma, {
        billingSubscriptionId: subscriptionGid,
        billingTier: nextTier,
        shopRecord,
        context: { source: "webhook:APP_SUBSCRIPTIONS_UPDATE", from: currentTier, to: nextTier },
      });
      logger.info("Tier downgrade scheduled", {
        shop, from: currentTier, to: nextTier, effectiveAt,
      });
    }

    // Reprocess discounts if tier changed (immediate or deferred)
    if (tierChanged && admin) {
      const { reprocessAllDiscountsForShop } = await import("../utils/discount-resolver/reprocess.server.js");
      await reprocessAllDiscountsForShop(admin, shop, prisma);
    }

    // Update billing tier and period end
    if (subscriptionCurrentPeriodEnd) {
      try {
        await prisma.shop.update({
          where: { domain: shop },
          data: {
            billingTier: nextTier,
            billingCurrentPeriodEnd: new Date(subscriptionCurrentPeriodEnd),
          },
        });
      } catch (billingErr) {
        logger.error("Failed to update billing tier sync", { err: billingErr, shop });
      }
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error("Error processing app_subscriptions/update webhook", { err: error, shop });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
