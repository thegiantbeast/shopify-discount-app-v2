import { createLogger } from "../logger.server.js";
import { graphqlQuery } from "./graphql-client.server.js";
import { GET_ALL_DISCOUNTS_QUERY, GET_DISCOUNT_NODE_QUERY } from "./graphql-queries.server.js";
import { resolveDiscountTargets } from "./resolve-targets.server.js";
import { storeDiscountData } from "./discount-storage.server.js";
import { updateLiveDiscountData } from "./live-discount-updater.server.js";
import { ensureLiveDiscountsForShop } from "./backfill.server.js";
import { storeCollectionData, storeProductData } from "./store-data.server.js";

const logger = createLogger("Reprocess");

/**
 * Full re-sync of ALL discounts from Shopify.
 * Triggered by tier changes and manual rebuilds.
 */
export async function reprocessAllDiscountsForShop(admin, shop, db) {
  try {
    let hasNextPage = true;
    let after = null;
    let total = 0;
    let processed = 0;
    let createdOrUpdated = 0;
    let added = 0;
    let deleted = 0;
    let errors = 0;

    while (hasNextPage) {
      const result = await graphqlQuery(admin, GET_ALL_DISCOUNTS_QUERY, { after });
      const data = result.data;

      if (!data?.discountNodes?.edges) {
        if (result.errors) {
          logger.error("GraphQL error during reprocess", { errors: result.errors });
        }
        break;
      }

      const edges = data.discountNodes.edges;
      hasNextPage = data.discountNodes.pageInfo?.hasNextPage || false;
      after = hasNextPage ? data.discountNodes.pageInfo.endCursor : null;
      total += edges.length;

      for (const edge of edges) {
        const node = edge.node;
        if (!node?.discount) continue;
        processed++;

        try {
          const prev = await db.discount.findFirst({
            where: { gid: node.id, shop },
          });

          const resolved = await resolveDiscountTargets(admin, node.discount, shop, db);
          const resolvedTargets = resolved || { productIds: [], variantIds: [] };

          const stored = await storeDiscountData(
            node.id,
            node.discount,
            resolvedTargets,
            shop,
            db,
          );

          const live = await updateLiveDiscountData(
            node.id,
            node.discount,
            shop,
            db,
            { preserveExistingStatus: true },
          );

          if (stored && live) createdOrUpdated++;

          const post = await db.discount.findFirst({
            where: { gid: node.id, shop },
          });

          if (!prev && post) added++;
          if (prev && !post) deleted++;
        } catch (err) {
          errors++;
          logger.error(
            "Failed to reprocess discount",
            { err, discountId: node.id, shop }
          );
        }
      }
    }

    const backfillResult = await ensureLiveDiscountsForShop(shop, db);

    logger.info(
      "Reprocess completed",
      {
        shop,
        total,
        processed,
        createdOrUpdated,
        added,
        deleted,
        backfilled: backfillResult.backfilled,
        errors,
      }
    );

    return {
      total,
      processed,
      updated: createdOrUpdated,
      added,
      deleted,
      backfilled: backfillResult.backfilled,
    };
  } catch (error) {
    logger.error("Error reprocessing discounts", { err: error, shop });
    return { total: 0, processed: 0, updated: 0 };
  }
}

/**
 * Incremental reprocessing: only discounts targeting a specific collection.
 * Uses DiscountTarget junction table for efficient lookup.
 */
export async function reprocessDiscountsForCollection(admin, collectionGid, shop, db) {
  try {
    // Find discounts that target this collection via junction table
    const affectedTargets = await db.discountTarget.findMany({
      where: {
        targetType: "COLLECTION",
        targetGid: collectionGid,
        discount: { shop },
      },
      include: { discount: true },
    });

    if (affectedTargets.length === 0) {
      logger.debug("No discounts target this collection", { shop, collectionGid });
      return { processed: 0 };
    }

    let processed = 0;
    let errors = 0;

    for (const target of affectedTargets) {
      const discount = target.discount;
      try {
        // Fetch latest discount data from Shopify
        const result = await graphqlQuery(admin, GET_DISCOUNT_NODE_QUERY, { id: discount.gid });
        const discountNode = result.data?.discountNode;

        if (!discountNode?.discount) {
          logger.warn(
            { discountGid: discount.gid },
            "Discount not found in Shopify during collection reprocess",
          );
          continue;
        }

        const resolved = await resolveDiscountTargets(
          admin,
          discountNode.discount,
          shop,
          db,
          { forceRefresh: true },
        );
        const resolvedTargets = resolved || { productIds: [], variantIds: [] };

        await storeDiscountData(
          discount.gid,
          discountNode.discount,
          resolvedTargets,
          shop,
          db,
        );

        await updateLiveDiscountData(
          discount.gid,
          discountNode.discount,
          shop,
          db,
          { preserveExistingStatus: true },
        );

        processed++;
      } catch (err) {
        errors++;
        logger.error(
          "Error reprocessing discount for collection change",
          { err, discountGid: discount.gid, collectionGid }
        );
      }
    }

    logger.info(
      "Collection reprocess completed",
      { shop, collectionGid, processed, errors, total: affectedTargets.length }
    );

    return { processed, errors };
  } catch (error) {
    logger.error(
      "Error in reprocessDiscountsForCollection",
      { err: error, shop, collectionGid }
    );
    return { processed: 0, errors: 1 };
  }
}

/**
 * Incremental reprocessing: only discounts targeting a specific product.
 * Uses DiscountProduct junction table for efficient lookup.
 */
export async function reprocessDiscountsForProduct(admin, productGid, shop, db) {
  try {
    // Find discounts that include this product via junction table
    const affectedProducts = await db.discountProduct.findMany({
      where: {
        productGid,
        discount: { shop },
      },
      include: { discount: true },
    });

    if (affectedProducts.length === 0) {
      logger.debug("No discounts include this product", { shop, productGid });
      return { processed: 0 };
    }

    let processed = 0;
    let errors = 0;

    for (const dp of affectedProducts) {
      const discount = dp.discount;
      try {
        const result = await graphqlQuery(admin, GET_DISCOUNT_NODE_QUERY, { id: discount.gid });
        const discountNode = result.data?.discountNode;

        if (!discountNode?.discount) {
          logger.warn(
            { discountGid: discount.gid },
            "Discount not found in Shopify during product reprocess",
          );
          continue;
        }

        const resolved = await resolveDiscountTargets(
          admin,
          discountNode.discount,
          shop,
          db,
          { forceRefresh: true },
        );
        const resolvedTargets = resolved || { productIds: [], variantIds: [] };

        await storeDiscountData(
          discount.gid,
          discountNode.discount,
          resolvedTargets,
          shop,
          db,
        );

        await updateLiveDiscountData(
          discount.gid,
          discountNode.discount,
          shop,
          db,
          { preserveExistingStatus: true },
        );

        processed++;
      } catch (err) {
        errors++;
        logger.error(
          "Error reprocessing discount for product change",
          { err, discountGid: discount.gid, productGid }
        );
      }
    }

    logger.info(
      "Product reprocess completed",
      { shop, productGid, processed, errors, total: affectedProducts.length }
    );

    return { processed, errors };
  } catch (error) {
    logger.error(
      "Error in reprocessDiscountsForProduct",
      { err: error, shop, productGid }
    );
    return { processed: 0, errors: 1 };
  }
}
