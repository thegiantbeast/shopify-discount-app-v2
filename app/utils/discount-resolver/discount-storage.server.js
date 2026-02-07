import { createLogger } from "../logger.server.js";
import {
  ensureArray,
  getDiscountClassValue,
  isAllCustomersSelection,
} from "./utils.server.js";
import { computeDiscountType, getTemporalBounds } from "./status-utils.server.js";

const logger = createLogger("DiscountStorage");

/**
 * Store discount data in the Discount table + junction tables.
 * Stores ALL discounts regardless of exclusion status.
 * Exclusion logic is in updateLiveDiscountData().
 */
export async function storeDiscountData(discountId, discountData, resolvedData, shop, db) {
  try {
    const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
    if (!shopRecord) {
      logger.error("Shop not found for storeDiscountData", { shop, discountId });
      return false;
    }

    const discountType = computeDiscountType(discountId);
    const title = discountData.title || "Untitled discount";
    const status = discountData.status || "UNKNOWN";
    const value = discountData.customerGets?.value;
    let valueType = "PERCENTAGE";
    let percentage = null;
    let amount = null;
    let currencyCode = null;

    if (value?.percentage !== undefined) {
      valueType = "PERCENTAGE";
      percentage = value.percentage;
    } else if (value?.amount) {
      valueType = "AMOUNT";
      amount = parseFloat(value.amount.amount);
      currencyCode = value.amount.currencyCode;
    }

    const items = discountData.customerGets?.items;
    const itemsArray = ensureArray(items);
    let targetType = "UNKNOWN";
    const targetGids = [];

    if (itemsArray.some((item) => item?.collections)) {
      targetType = "COLLECTION";
      for (const item of itemsArray) {
        if (item?.collections?.nodes) {
          targetGids.push(...item.collections.nodes.map((node) => ({ type: "COLLECTION", gid: node.id })));
        }
      }
    } else if (itemsArray.some((item) => item?.products) || itemsArray.some((item) => item?.productVariants)) {
      targetType = "PRODUCT";
      for (const item of itemsArray) {
        if (item?.products?.nodes) {
          targetGids.push(...item.products.nodes.map((node) => ({ type: "PRODUCT", gid: node.id })));
        }
        if (item?.productVariants?.nodes) {
          targetGids.push(...item.productVariants.nodes.map((node) => ({ type: "VARIANT", gid: node.id })));
        }
      }
    }

    const selection = discountData.context || discountData.customerSelection;
    const customerSelectionAll = isAllCustomersSelection(selection);

    const codes = [];
    if (discountType === "CODE" && discountData.codes?.nodes) {
      codes.push(...discountData.codes.nodes.map((node) => node.code));
    }

    const { startsAt, endsAt } = getTemporalBounds(discountData);

    const discountFields = {
      shop,
      shopId: shopRecord.id,
      title,
      status,
      startsAt,
      endsAt: endsAt || null,
      summary: discountData.summary || null,
      discountClass: getDiscountClassValue(discountData) || "UNKNOWN",
      discountType,
      targetType,
      valueType,
      percentage,
      amount,
      currencyCode,
      appliesOnOneTimePurchase: Boolean(discountData.customerGets?.appliesOnOneTimePurchase),
      appliesOnSubscription: Boolean(discountData.customerGets?.appliesOnSubscription),
      customerSelectionAll,
      customerSegments: JSON.stringify([]),
      minimumRequirement: discountData.minimumRequirement || null,
    };

    // Upsert the Discount record
    const discount = await db.discount.upsert({
      where: { gid: discountId },
      update: { ...discountFields, updatedAt: new Date() },
      create: { gid: discountId, ...discountFields },
    });

    // Update junction tables — delete old data and re-create
    // Using a transaction for atomicity
    await db.$transaction([
      db.discountTarget.deleteMany({ where: { discountId: discount.id } }),
      db.discountProduct.deleteMany({ where: { discountId: discount.id } }),
      db.discountVariant.deleteMany({ where: { discountId: discount.id } }),
      db.discountCode.deleteMany({ where: { discountId: discount.id } }),
    ]);

    // Write new junction table data
    if (targetGids.length > 0) {
      await db.discountTarget.createMany({
        data: targetGids.map((t) => ({
          discountId: discount.id,
          targetType: t.type,
          targetGid: t.gid,
        })),
        skipDuplicates: true,
      });
    }

    if (resolvedData.productIds.length > 0) {
      await db.discountProduct.createMany({
        data: resolvedData.productIds.map((gid) => ({
          discountId: discount.id,
          productGid: gid,
        })),
        skipDuplicates: true,
      });
    }

    if (resolvedData.variantIds.length > 0) {
      await db.discountVariant.createMany({
        data: resolvedData.variantIds.map((gid) => ({
          discountId: discount.id,
          variantGid: gid,
        })),
        skipDuplicates: true,
      });
    }

    if (codes.length > 0) {
      await db.discountCode.createMany({
        data: codes.map((code) => ({
          discountId: discount.id,
          code,
        })),
        skipDuplicates: true,
      });
    }

    return true;
  } catch (error) {
    logger.error("Failed to store discount data", { err: error, discountId, shop });
    return false;
  }
}
